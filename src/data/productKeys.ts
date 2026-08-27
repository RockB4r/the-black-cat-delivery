const keysByProductName: Record<string, string> = {
  'Misfits Burger': 'misfits-burger',
  'Queen Burger': 'queen-burger',
  'Ramones Burger': 'ramones-burger',
  'Rancid Burger': 'rancid-burger',
  'The Clash Burger': 'the-clash-burger',
  'Chicken Club': 'chicken-club',
  'American Way': 'american-way',
  'Fat Cat': 'fat-cat',
  'Chicken Quesadilla': 'chicken-quesadilla',
  Choripan: 'choripan',
  Wings: 'wings',
  'Papas Bravas': 'papas-bravas',
  'Papas & Cheddar': 'papas-cheddar',
  'Chori-Bravas': 'chori-bravas',
  Nachos: 'nachos',
  Tequeños: 'tequenos',
  'Sierra Andina': 'sierra-andina',
  Invictus: 'invictus',
  Craftsman: 'craftsman',
  'Dörcher Bier': 'dorcher-bier',
  Zátara: 'zatara',
  'Caños del Santero': 'canos-del-santero',
  'Cervecería del Valle Sagrado': 'cerveceria-del-valle-sagrado',
  Almirante: 'almirante',
  '7 Vidas': '7-vidas',
  Greenga: 'greenga',
  'Jack Vled': 'jack-vled',
}

export const productKey = (name: string) => keysByProductName[name]

export const productKeys = Object.values(keysByProductName)
