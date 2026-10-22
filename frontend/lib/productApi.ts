import api from './api'
import type { FulfillmentClass } from './rxCartApi'

export interface Product {
  id: string
  name: string
  description?: string
  sku?: string
  price: string | number
  fulfillmentClass?: FulfillmentClass
  aliases?: string[]
  inventoryItem?: {
    quantityInStock: number
  }
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
