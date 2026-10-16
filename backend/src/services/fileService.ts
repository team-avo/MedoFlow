import crypto from 'crypto'
import type { Request } from 'express'
import type { Prisma } from '@prisma/client'
import prisma from '../config/prisma'
import { clinicScope } from '../config/tenantContext'
import { logAudit, logRead, requestMeta } from './auditService'
import type { ApiError } from '../types/errors'
import * as patientMembershipService from './patientMembershipService'
import {
  getPatientFileStorage,
  resolveStorageRef,
  patientFileKey,
  type PresignedUpload,
} from './fileStorage'
import {
  FILE_SIZE_LIMIT_BYTES,
  PENDING_UPLOAD_MAX_AGE_MS,
  getFileUrlTtlSeconds,
  isMimeAllowed,
} from '../config/fileConstants'
import { contentMatchesMime, SNIFF_BYTES } from '../utils/fileSniff'

const apiError = (statusCode: number, message: string, code?: string): ApiError => {
  const err = new Error(message) as ApiError
  err.statusCode = statusCode
  if (code) err.code = code
  return err
}

/**
 * Fields a file listing returns (minimum necessary, F0.3.4): no storage
 * reference, no uploader email.
 */
const FILE_LIST_SELECT = {
  id: true,
  clinicId: true,
  patientId: true,
  visitRecordId: true,
  originalName: true,
  mimeType: true,
  size: true,
  tags: true,
  createdAt: true,
  uploadedBy: { select: { id: true, name: true } },
} satisfies Prisma.PatientFileSelect

export interface UploadIntent {
  fileId: string
  uploadUrl: string
  method: PresignedUpload['method']
  /** Headers the client must send with the PUT (they are signed). */
  headers: PresignedUpload['headers']
  expiresAt: string
}

/**
 * Step 1 of an upload (B3.1): validate the request and issue a presigned PUT
 * straight to object storage. The row stays PENDING — invisible to every
 * listing and download — until completeUpload() has verified the object.
 */
export const createUploadIntent = async (params: {
  clinicId: string
  patientId: string
  visitRecordId?: string | null
  uploadedById: string
  fileName: string
  mimeType: string
  size: number
  tags?: unknown
  baseUrl: string
}): Promise<UploadIntent> => {
  const mimeType = params.mimeType.toLowerCase()
  if (!isMimeAllowed(mimeType))
    throw apiError(400, 'File type not allowed', 'file_type_not_allowed')
  if (!(params.size > 0) || params.size > FILE_SIZE_LIMIT_BYTES) {
    throw apiError(400, 'File is empty or larger than the upload limit', 'file_too_large')
  }

  await patientMembershipService.assertPatientBelongsToClinic(params.patientId, params.clinicId)
  if (params.visitRecordId) {
    const visit = await prisma.visitRecord.findFirst({
      where: { id: params.visitRecordId, clinicId: params.clinicId, patientId: params.patientId },
      select: { id: true },
    })
    if (!visit) throw apiError(404, 'Visit record not found or does not belong to patient')
  }

  const storage = getPatientFileStorage()
  const key = patientFileKey(params.clinicId, params.patientId, crypto.randomUUID())
  const file = await prisma.patientFile.create({
    data: {
      clinicId: params.clinicId,
      patientId: params.patientId,
      visitRecordId: params.visitRecordId ?? null,
      uploadedById: params.uploadedById,
      originalName: params.fileName,
      storagePath: storage.refFor(key),
      mimeType,
      size: params.size,
      tags: params.tags != null ? (params.tags as Prisma.InputJsonValue) : undefined,
      status: 'PENDING',
    },
    select: { id: true },
  })

  const expiresIn = getFileUrlTtlSeconds()
  const upload = await storage.createUploadUrl(key, {
    contentType: mimeType,
    contentLength: params.size,
    expiresIn,
    baseUrl: params.baseUrl,
  })
  return {
    fileId: file.id,
    uploadUrl: upload.url,
    method: upload.method,
    headers: upload.headers,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  }
}

/**
 * Step 2 of an upload: the object must exist, have exactly the declared
 * size, and its leading bytes must match the declared type. Anything else
 * is deleted from storage and the row is marked REJECTED.
 */
export const completeUpload = async (
  fileId: string,
  clinicId: string,
  req: Request
): Promise<{ id: string }> => {
  const file = await prisma.patientFile.findFirst({
    where: { id: fileId, clinicId, isDeleted: false },
  })
  if (!file) throw apiError(404, 'File not found')
  if (file.status === 'AVAILABLE') return { id: file.id }
  if (file.status === 'REJECTED') throw apiError(409, 'This upload was rejected', 'upload_rejected')

  const { driver, key } = resolveStorageRef(file.storagePath)
  const stored = await driver.head(key)
  if (!stored) throw apiError(409, 'The file has not been uploaded yet', 'upload_incomplete')

  const head =
    stored.size > 0
      ? await driver.readHead(key, Math.min(SNIFF_BYTES, stored.size))
      : Buffer.alloc(0)
  const sizeOk = stored.size === file.size
  const contentOk =
    sizeOk && isMimeAllowed(file.mimeType) && contentMatchesMime(head, file.mimeType, stored.size)

  if (!contentOk) {
    await driver.delete(key)
    await prisma.patientFile.update({
      where: { id: file.id, clinicId },
      data: { status: 'REJECTED' },
    })
    await logAudit({
      clinicId,
      entityType: 'PatientFile',
      entityId: file.id,
      action: 'FILE_UPLOAD_REJECTED',
      newValue: { reason: sizeOk ? 'content_mismatch' : 'size_mismatch', mimeType: file.mimeType },
      performedById: req.user!.id,
      severity: 'warning',
      ...requestMeta(req),
    })
    throw apiError(
      422,
      sizeOk ? 'The file content does not match its type' : 'The uploaded file size does not match',
      'file_content_mismatch'
    )
  }

  await prisma.patientFile.update({
    where: { id: file.id, clinicId },
    data: { status: 'AVAILABLE', uploadedAt: new Date() },
  })
  // No filename in the audit row: the entity id identifies the file.
  await logAudit({
    clinicId,
    entityType: 'PatientFile',
    entityId: file.id,
    action: 'FILE_UPLOADED',
    newValue: { mimeType: file.mimeType, size: file.size, visitRecordId: file.visitRecordId },
    performedById: req.user!.id,
    ...requestMeta(req),
  })
  return { id: file.id }
}

export const getFilesByPatient = async (clinicId: string, patientId: string) => {
  return prisma.patientFile.findMany({
    where: { clinicId, patientId, isDeleted: false, status: 'AVAILABLE' },
    select: FILE_LIST_SELECT,
    orderBy: { createdAt: 'desc' },
  })
}

export interface DownloadGrant {
  url: string
  expiresAt: string
  fileName: string
  mimeType: string
}

const issueDownload = async (
  file: {
    id: string
    clinicId: string
    storagePath: string
    originalName: string
    mimeType: string
  },
  req: Request,
  baseUrl: string
): Promise<DownloadGrant> => {
  const { driver, key } = resolveStorageRef(file.storagePath)
  if (!(await driver.head(key))) throw apiError(404, 'File not found')
  const expiresIn = getFileUrlTtlSeconds()
  const url = await driver.createDownloadUrl(key, {
    contentType: file.mimeType,
    expiresIn,
    baseUrl,
  })
  // One audit row per access (B0.3.1): actor, entity, time, IP, user agent.
  await logRead(req, { entityType: 'PatientFile', entityId: file.id, clinicId: file.clinicId })
  return {
    url,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    fileName: file.originalName,
    mimeType: file.mimeType,
  }
}

/** Staff download: the file must be in the caller's clinic and its patient a member. */
export const getStaffDownloadUrl = async (
  fileId: string,
  clinicId: string,
  req: Request,
  baseUrl: string
): Promise<DownloadGrant> => {
  const file = await prisma.patientFile.findFirst({
    where: { id: fileId, clinicId, isDeleted: false, status: 'AVAILABLE' },
  })
  if (!file) throw apiError(404, 'File not found')
  if (!(await validatePatientBelongsToClinic(file.patientId, clinicId))) {
    throw apiError(403, 'Access denied')
  }
  return issueDownload(file, req, baseUrl)
}

/** Patient download: only the patient's own files, in a clinic they belong to. */
export const getPatientDownloadUrl = async (
  fileId: string,
  patientId: string,
  clinicId: string,
  req: Request,
  baseUrl: string
): Promise<DownloadGrant> => {
  await patientMembershipService.assertPatientBelongsToClinic(patientId, clinicId)
  const file = await prisma.patientFile.findFirst({
    where: { id: fileId, clinicId, patientId, isDeleted: false, status: 'AVAILABLE' },
  })
  if (!file) throw apiError(404, 'File not found')
  return issueDownload(file, req, baseUrl)
}

export const softDeleteFile = async (
  fileId: string,
  clinicId: string,
  performedById: string,
  req?: Request
): Promise<void> => {
  const file = await prisma.patientFile.findFirst({
    where: { id: fileId, clinicId },
  })
  if (!file) throw apiError(404, 'File not found')
  if (file.isDeleted) throw apiError(400, 'File already deleted')

  await prisma.patientFile.update({
    where: { id: fileId, clinicId },
    data: { isDeleted: true },
  })

  await logAudit({
    clinicId,
    entityType: 'PatientFile',
    entityId: fileId,
    action: 'FILE_DELETED',
    oldValue: { mimeType: file.mimeType, size: file.size, isDeleted: false },
    newValue: { isDeleted: true },
    performedById,
    ...(req ? requestMeta(req) : {}),
  })
}

export const validatePatientBelongsToClinic = async (
  patientId: string,
  clinicId: string
): Promise<boolean> => {
  const membership = await prisma.patientClinicMembership.findFirst({
    where: {
      patientId,
      clinicId,
      isActive: true,
    },
  })
  return !!membership
}

export const getPatientPrimaryClinicId = async (patientId: string): Promise<string | null> => {
  const membership = await prisma.patientClinicMembership.findFirst({
    where: { patientId, isActive: true, ...clinicScope() },
    select: { clinicId: true },
    orderBy: { updatedAt: 'desc' },
  })
  return membership?.clinicId ?? null
}

export const assertPatientCanAccessClinicFiles = async (
  patientId: string,
  clinicId: string
): Promise<void> => {
  await patientMembershipService.assertPatientBelongsToClinic(patientId, clinicId)
}

/**
 * Janitor (runs from the cron bypass scope): uploads that were started but
 * never completed within PENDING_UPLOAD_MAX_AGE_MS are removed from storage
 * and marked REJECTED.
 */
export const sweepStalePendingUploads = async (now = new Date()): Promise<number> => {
  const stale = await prisma.patientFile.findMany({
    where: {
      status: 'PENDING',
      createdAt: { lt: new Date(now.getTime() - PENDING_UPLOAD_MAX_AGE_MS) },
    },
    select: { id: true, clinicId: true, storagePath: true },
    take: 500,
  })
  for (const f of stale) {
    try {
      const { driver, key } = resolveStorageRef(f.storagePath)
      await driver.delete(key)
    } catch {
      // Object already gone or storage briefly unavailable: the row is still retired.
    }
    await prisma.patientFile.update({
      where: { id: f.id, clinicId: f.clinicId },
      data: { status: 'REJECTED' },
    })
  }
  return stale.length
}
