/**
 * Centralised Permission Registry
 * ────────────────────────────────
 * Every granular permission in the system is defined here once.
 * Roles created by admins reference these keys.
 *
 * Format: "module.action"
 */

export interface PermissionDef {
  key: string
  label: string
  description?: string
}

export interface PermissionGroup {
  module: string
  label: string
  permissions: PermissionDef[]
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    module: 'dashboard',
    label: 'Dashboard',
    permissions: [
      {
        key: 'dashboard.view',
        label: 'View Dashboard',
        description: 'Access the main admin dashboard',
      },
    ],
  },
  {
    module: 'appointments',
    label: 'Appointments',
    permissions: [
      {
        key: 'appointments.view',
        label: 'View Appointments',
        description: 'View all appointment schedules',
      },
      {
        key: 'appointments.create',
        label: 'Create Appointments',
        description: 'Book new appointments',
      },
      {
        key: 'appointments.edit',
        label: 'Edit Appointments',
        description: 'Modify existing appointments',
      },
      {
        key: 'appointments.cancel',
        label: 'Cancel Appointments',
        description: 'Cancel or reschedule',
      },
    ],
  },
  {
    module: 'patients',
    label: 'Patients',
    permissions: [
      {
        key: 'patients.view',
        label: 'View Patients',
        description: 'Access patient list and profiles',
      },
      { key: 'patients.create', label: 'Add Patients', description: 'Register new patients' },
      {
        key: 'patients.edit',
        label: 'Edit Patient Info',
        description: 'Update patient information',
      },
      {
        key: 'patients.view_records',
        label: 'View Clinical Records',
        description: 'Access visit notes and medical records',
      },
    ],
  },
  {
    module: 'billing',
    label: 'Billing & Payments',
    permissions: [
      {
        key: 'billing.view',
        label: 'View Invoices',
        description: 'See all invoices and billing data',
      },
      { key: 'billing.create', label: 'Create Invoices', description: 'Generate new invoices' },
      {
        key: 'billing.process_payments',
        label: 'Process Payments',
        description: 'Accept and process payments',
      },
      {
        key: 'billing.refunds',
        label: 'Issue Refunds',
        description: 'Process returns and refunds',
      },
      {
        key: 'billing.view_reports',
        label: 'View Financial Reports',
        description: 'Access revenue and financial analytics',
      },
    ],
  },
  {
    module: 'products',
    label: 'Products & Inventory',
    permissions: [
      { key: 'products.view', label: 'View Products', description: 'Browse the product catalogue' },
      {
        key: 'products.manage',
        label: 'Manage Products',
        description: 'Add, edit, and remove products',
      },
      {
        key: 'products.inventory',
        label: 'Manage Inventory',
        description: 'Update stock levels and reorder info',
      },
    ],
  },
  {
    module: 'services',
    label: 'Services',
    permissions: [
      {
        key: 'services.view',
        label: 'View Services',
        description: 'See available clinic services',
      },
      {
        key: 'services.manage',
        label: 'Manage Services',
        description: 'Create and update services',
      },
    ],
  },
  {
    module: 'staff',
    label: 'Staff & Roles',
    permissions: [
      { key: 'staff.view', label: 'View Staff', description: 'See staff directory' },
      {
        key: 'staff.manage',
        label: 'Manage Staff',
        description: 'Invite, edit, and deactivate staff',
      },
      {
        key: 'staff.roles',
        label: 'Manage Roles',
        description: 'Create and configure roles and permissions',
      },
    ],
  },
  {
    module: 'settings',
    label: 'Settings',
    permissions: [
      {
        key: 'settings.clinic',
        label: 'Clinic Settings',
        description: 'Modify clinic details and preferences',
      },
      {
        key: 'settings.locations',
        label: 'Manage Locations',
        description: 'Add or edit clinic locations',
      },
      {
        key: 'settings.disciplines',
        label: 'Manage Disciplines',
        description: 'Configure clinical disciplines',
      },
      {
        key: 'settings.commissions',
        label: 'Manage Commissions',
        description: 'Set up provider commission rules',
      },
    ],
  },
  {
    module: 'analytics',
    label: 'Analytics & Reports',
    permissions: [
      {
        key: 'analytics.view',
        label: 'View Analytics',
        description: 'Access analytics dashboards',
      },
      {
        key: 'analytics.export',
        label: 'Export Reports',
        description: 'Download and export report data',
      },
    ],
  },
  {
    module: 'memberships',
    label: 'Memberships & Packages',
    permissions: [
      {
        key: 'memberships.view',
        label: 'View Memberships',
        description: 'Browse membership plans',
      },
      {
        key: 'memberships.manage',
        label: 'Manage Memberships',
        description: 'Create and update memberships',
      },
      { key: 'packages.view', label: 'View Packages', description: 'Browse session packages' },
      {
        key: 'packages.manage',
        label: 'Manage Packages',
        description: 'Create and update packages',
      },
    ],
  },
]

/** Flat list of all valid permission keys, use for validation */
export const ALL_PERMISSION_KEYS: string[] = PERMISSION_GROUPS.flatMap((g) =>
  g.permissions.map((p) => p.key)
)

/**
 * Preset role templates.
 * Choosing one of these pre-fills the permission checkboxes.
 * The admin can then customise further before saving.
 */
export const ROLE_PRESETS: Record<string, { description: string; permissions: string[] }> = {
  Admin: {
    description: 'Full access to all clinic operations',
    permissions: ALL_PERMISSION_KEYS, // everything
  },
  'Front Desk': {
    description: 'Reception, scheduling, and patient intake',
    permissions: [
      'dashboard.view',
      'appointments.view',
      'appointments.create',
      'appointments.edit',
      'appointments.cancel',
      'patients.view',
      'patients.create',
      'patients.edit',
      'billing.view',
      'billing.create',
      'billing.process_payments',
      'products.view',
      'services.view',
      'memberships.view',
      'packages.view',
    ],
  },
  Accounting: {
    description: 'Billing, payments, and financial reporting',
    permissions: [
      'dashboard.view',
      'billing.view',
      'billing.create',
      'billing.process_payments',
      'billing.refunds',
      'billing.view_reports',
      'analytics.view',
      'analytics.export',
      'products.view',
      'services.view',
      'memberships.view',
      'packages.view',
      'settings.commissions',
    ],
  },
}

/** Check whether a set of permissions includes a specific key (handles the '*' wildcard) */
export function hasPermission(userPermissions: string[], requiredKey: string): boolean {
  if (userPermissions.includes('*')) return true
  return userPermissions.includes(requiredKey)
}
