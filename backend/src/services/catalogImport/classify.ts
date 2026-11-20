/**
 * CTO-40: a suggested fulfillment class for an imported item, from its name,
 * product type and tags. It is only a suggestion: every imported product is
 * stored UNCLASSIFIED unless a person picks a class in the preview (B5.5).
 *
 * Anything that looks like a prescription product never gets a suggestion,
 * so a person must decide (and RX_* routes to e-prescribing, not the cart).
 */
import type { ProductFulfillmentClass } from '@prisma/client'
import type { NormalizedItem } from './types'

/** Words that mean "a person must look at this". Matched as whole words. */
const RX_WORDS = [
  'rx',
  'prescription',
  'prescribed',
  'injection',
  'injectable',
  'inj',
  'vial',
  'ampoule',
  'syringe',
  'compounded',
  'compound',
  'semaglutide',
  'tirzepatide',
  'liraglutide',
  'ozempic',
  'wegovy',
  'mounjaro',
  'zepbound',
  'testosterone',
  'estradiol',
  'progesterone',
  'hcg',
  'enclomiphene',
  'clomiphene',
  'anastrozole',
  'sermorelin',
  'ipamorelin',
  'tesamorelin',
  'bpc',
  'peptide',
  'peptides',
  'nad',
  'ketamine',
  'naltrexone',
  'metformin',
  'rapamycin',
  'sirolimus',
  'sildenafil',
  'tadalafil',
  'finasteride',
  'dutasteride',
  'tretinoin',
  'spironolactone',
  'botox',
  'dysport',
  'xeomin',
  'filler',
  'juvederm',
  'restylane',
  'sculptra',
  'kybella',
  'lidocaine',
  'antibiotic',
  'schedule',
  'controlled',
  'narcotic',
]

const SUPPLEMENT_WORDS = [
  'supplement',
  'supplements',
  'vitamin',
  'vitamins',
  'multivitamin',
  'mineral',
  'magnesium',
  'zinc',
  'iron',
  'calcium',
  'omega',
  'fish oil',
  'probiotic',
  'probiotics',
  'prebiotic',
  'collagen',
  'protein',
  'creatine',
  'electrolyte',
  'electrolytes',
  'ashwagandha',
  'curcumin',
  'turmeric',
  'coq10',
  'ubiquinol',
  'resveratrol',
  'berberine',
  'quercetin',
  'nmn',
  'glutathione',
  'melatonin',
  'fiber',
  'greens',
  'nutraceutical',
  'capsules',
  'softgels',
  'gummies',
  'powder',
]

const AESTHETIC_WORDS = [
  'skincare',
  'skin care',
  'serum',
  'cream',
  'moisturizer',
  'moisturiser',
  'cleanser',
  'toner',
  'sunscreen',
  'spf',
  'mask',
  'exfoliant',
  'peel',
  'retinol',
  'hyaluronic',
  'eye cream',
  'lotion',
  'balm',
  'cosmetic',
  'cosmetics',
  'aesthetic',
  'beauty',
  'haircare',
  'hair care',
  'shampoo',
  'conditioner',
]

const OTC_WORDS = [
  'otc',
  'over the counter',
  'pain relief',
  'ibuprofen',
  'acetaminophen',
  'paracetamol',
  'aspirin',
  'naproxen',
  'antihistamine',
  'loratadine',
  'cetirizine',
  'antacid',
  'laxative',
  'cough',
  'cold and flu',
  'first aid',
  'bandage',
  'thermometer',
  'hydrocortisone',
]

const normalize = (s: string) =>
  ` ${s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `

const hasAny = (text: string, words: string[]) => words.some((w) => text.includes(` ${w} `))

export interface ClassSuggestion {
  suggested: ProductFulfillmentClass | null
  /** Looks like a prescription product: shown with a warning, never suggested. */
  rxLike: boolean
}

export function suggestClass(
  item: Pick<NormalizedItem, 'name' | 'category' | 'tags'>
): ClassSuggestion {
  const text = normalize([item.name, item.category ?? '', ...item.tags].join(' '))
  if (hasAny(text, RX_WORDS)) return { suggested: null, rxLike: true }
  // Product type and tags speak louder than words in the name.
  const typeText = normalize([item.category ?? '', ...item.tags].join(' '))
  for (const t of [typeText, text]) {
    if (hasAny(t, OTC_WORDS)) return { suggested: 'OTC', rxLike: false }
    if (hasAny(t, AESTHETIC_WORDS)) return { suggested: 'AESTHETIC', rxLike: false }
    if (hasAny(t, SUPPLEMENT_WORDS)) return { suggested: 'SUPPLEMENT', rxLike: false }
  }
  return { suggested: null, rxLike: false }
}
