export type MenuItem = {
  name: string
  price: number
  image?: string
  ingredients?: string
}

export type MenuCategory = {
  id: string
  name: string
  items: MenuItem[]
}
