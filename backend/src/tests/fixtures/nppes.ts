/**
 * Recorded NPPES API v2.1 answers (shape as returned by
 * npiregistry.cms.hhs.gov/api/?version=2.1&number=…), with synthetic names.
 * Used by the NPI lookup tests (CTO-29); nothing calls the real registry.
 */
export const NPPES_ORGANISATION = {
  result_count: 1,
  results: [
    {
      enumeration_type: 'NPI-2',
      number: '1234567893',
      basic: { organization_name: 'SYNTHETIC WELLNESS PARTNERS LLC', status: 'A' },
      taxonomies: [{ desc: 'Clinic/Center, Primary Care', primary: true, state: 'TX' }],
      addresses: [{ address_purpose: 'LOCATION', state: 'TX' }],
    },
  ],
}

export const NPPES_INDIVIDUAL = {
  result_count: 1,
  results: [
    {
      enumeration_type: 'NPI-1',
      number: '1987654328',
      basic: { first_name: 'OLIVIA', last_name: 'SYNTHETIC', credential: 'MD', status: 'A' },
      taxonomies: [{ desc: 'Internal Medicine', primary: true, state: 'TX' }],
      addresses: [{ address_purpose: 'LOCATION', state: 'TX' }],
    },
  ],
}

export const NPPES_DEACTIVATED = {
  result_count: 1,
  results: [
    {
      enumeration_type: 'NPI-1',
      number: '1334455668',
      basic: {
        first_name: 'GONE',
        last_name: 'SYNTHETIC',
        status: 'D',
        deactivation_date: '2020-01-01',
      },
      taxonomies: [],
      addresses: [],
    },
  ],
}

export const NPPES_NOT_FOUND = { result_count: 0, results: [] }
