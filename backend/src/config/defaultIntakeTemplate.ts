/**
 * The default patient intake form every clinic starts with (CTO-21). Its
 * "existing medical conditions" question has a follow-up: answered Yes, the
 * patient picks which ones, plus "Other" with free text. Answers are stored
 * field-encrypted like every other intake answer (FormResponse.responses).
 *
 * New clinics get it at sign-up; existing clinics add it from the Forms page
 * (POST /forms/templates/default, idempotent by name).
 */
export const DEFAULT_INTAKE_TEMPLATE_NAME = 'Patient intake'

export const DEFAULT_INTAKE_TEMPLATE = {
  name: DEFAULT_INTAKE_TEMPLATE_NAME,
  description: 'Health history before your first visit.',
  scope: 'CLINIC' as const,
  fields: [
    { id: 'reason', type: 'textarea', label: 'What brings you in today?', required: true },
    {
      id: 'existingConditions',
      type: 'select',
      label: 'Do you have any existing medical conditions?',
      required: true,
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ],
      followUp: {
        label: 'Which conditions?',
        required: true,
        allowOther: true,
        options: [
          { value: 'diabetes', label: 'Diabetes' },
          { value: 'hypertension', label: 'High blood pressure' },
          { value: 'heart_disease', label: 'Heart disease' },
          { value: 'asthma', label: 'Asthma or COPD' },
          { value: 'thyroid', label: 'Thyroid condition' },
          { value: 'cancer', label: 'Cancer (current or past)' },
          { value: 'autoimmune', label: 'Autoimmune condition' },
          { value: 'kidney', label: 'Kidney disease' },
          { value: 'depression_anxiety', label: 'Depression or anxiety' },
        ],
      },
    },
    { id: 'medications', type: 'textarea', label: 'Current medications and supplements' },
    { id: 'allergies', type: 'textarea', label: 'Allergies' },
  ],
}
