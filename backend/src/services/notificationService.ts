import prisma from '../config/prisma'
import * as emailService from './emailService'

export const sendAppointmentReminders = async (): Promise<number> => {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)

  const startOfTomorrow = new Date(tomorrow)
  startOfTomorrow.setHours(0, 0, 0, 0)

  const endOfTomorrow = new Date(tomorrow)
  endOfTomorrow.setHours(23, 59, 59, 999)

  const appointments = await prisma.appointment.findMany({
    where: {
      startTime: {
        gte: startOfTomorrow,
        lte: endOfTomorrow,
      },
      status: 'CONFIRMED',
      reminderSent: false,
    },
    include: {
      patient: true,
      provider: true,
      service: true,
      location: true,
    },
  })

  let sentCount = 0
  for (const appt of appointments) {
    try {
      await emailService.sendAppointmentReminder({
        to: appt.patient.email,
        patientName: appt.patient.name,
        appointmentDate: appt.startTime.toLocaleString(),
        serviceName: appt.service.name,
        providerName: `${appt.provider.firstName} ${appt.provider.lastName}`,
        locationName: appt.location?.name || 'Clinic',
      })

      await prisma.appointment.update({
        where: { id: appt.id, clinicId: appt.clinicId },
        data: { reminderSent: true },
      })
      sentCount++
    } catch (error) {
      console.error(`Failed to send reminder for appointment ${appt.id}:`, error)
    }
  }

  return sentCount
}
