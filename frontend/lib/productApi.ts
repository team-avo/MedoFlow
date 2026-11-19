import api from './api'
import type { FulfillmentClass, ProductClass } from './rxCartApi'

export interface Product {
  id: string
  name: string
  description?: string
  sku?: string
  price: string | number
  fulfillmentClass?: ProductClass
  aliases?: string[]
  inventoryItem?: {
    quantityInStock: number
  }
  /** CTO-40: product photo (imported or uploaded). */
  imageUrl?: string | null
  /** CTO-40: where an imported product came from (SHOPIFY, SQUARE, WOOCOMMERCE, WIX, CSV). */
  externalSource?: string | null
  externalSyncedAt?: string | null
}

export interface CreateProductPayload {
  name: string
  description?: string
  sku?: string
  price: number
  /** Prescription → Cart: RX_* products are routed to e-prescribe, never the cart. */
  fulfillmentClass?: FulfillmentClass
  /** Other names the scribe mapping should recognise. */
  aliases?: string[]
}

export const getProducts = async () => {
  const res = await api.get('/products')
  return res.data.data.products as Product[]
}

export const createProduct = async (payload: CreateProductPayload) => {
  const res = await api.post('/products', payload)
  return res.data.data.product as Product
}

export const updateProduct = async (id: string, payload: Partial<CreateProductPayload>) => {
  const res = await api.put(`/products/${id}`, payload)
  return res.data.data.product as Product
}

export const deleteProduct = async (id: string) => {
  await api.delete(`/products/${id}`)
}

/** Sets a product's stock count (SUPER_ADMIN; CTO-23). */
export const adjustStock = async (productId: string, quantityInStock: number) => {
  const res = await api.put(`/inventory/${productId}/adjust`, { quantityInStock })
  return res.data.data.inventoryItem as { quantityInStock: number }
}
