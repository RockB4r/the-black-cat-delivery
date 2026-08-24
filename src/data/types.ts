export type ProductStyle = {
  name: string
  price: number
}

export type MenuItem = {
  name: string
  price: number
  image?: string
  ingredients?: string
  styles?: ProductStyle[]
}

export type MenuCategory = {
  id: string
  name: string
  items: MenuItem[]
}
