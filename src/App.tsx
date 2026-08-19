import { useMemo, useState } from 'react'
import menuData from './data/menu.json'
import type { MenuCategory } from './data/types'
import './App.css'

type CartItem = { id: string; name: string; price: number; quantity: number }
type SubmittedOrder = {
  customerName: string
  customerPhone: string
  fulfillment: 'delivery' | 'pickup'
  address: string
  paymentMethod: string
  items: CartItem[]
  subtotal: number
}
const menuCategories = menuData as MenuCategory[]
const whatsappNumber = '51933622680'

function App() {
  const [activeCategoryId, setActiveCategoryId] = useState(menuCategories[0].id)
  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const [isCartOpen, setIsCartOpen] = useState(false)
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false)
  const [fulfillment, setFulfillment] = useState<'delivery' | 'pickup'>('delivery')
  const [paymentMethod, setPaymentMethod] = useState('Efectivo')
  const [isOrderSubmitted, setIsOrderSubmitted] = useState(false)
  const [submittedOrder, setSubmittedOrder] = useState<SubmittedOrder | null>(null)
  const activeCategory = menuCategories.find(({ id }) => id === activeCategoryId) ?? menuCategories[0]
  const itemCount = cartItems.reduce((total, item) => total + item.quantity, 0)
  const subtotal = useMemo(() => cartItems.reduce((total, item) => total + item.price * item.quantity, 0), [cartItems])

  const addToCart = (item: { name: string; price: number }) => {
    const id = `${activeCategory.id}-${item.name}`
    setCartItems((current) => {
      const existing = current.find((cartItem) => cartItem.id === id)
      return existing
        ? current.map((cartItem) => cartItem.id === id ? { ...cartItem, quantity: cartItem.quantity + 1 } : cartItem)
        : [...current, { ...item, id, quantity: 1 }]
    })
    setIsCartOpen(true)
  }

  const changeQuantity = (id: string, change: number) => {
    setCartItems((current) => current.flatMap((item) => {
      if (item.id !== id) return [item]
      const quantity = item.quantity + change
      return quantity > 0 ? [{ ...item, quantity }] : []
    }))
  }

  const removeItem = (id: string) => setCartItems((current) => current.filter((item) => item.id !== id))
  const startCheckout = () => {
    setIsCartOpen(false)
    setIsCheckoutOpen(true)
    setIsOrderSubmitted(false)
  }
  const whatsappLink = submittedOrder
    ? `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(
      [
        '🐈‍⬛ *NUEVO PEDIDO · THE BLACK CAT*',
        '',
        ...submittedOrder.items.map((item) => `• ${item.quantity}x ${item.name} — S/ ${(item.price * item.quantity).toFixed(2)}`),
        '',
        `*Total productos:* S/ ${submittedOrder.subtotal.toFixed(2)}`,
        `*Entrega:* ${submittedOrder.fulfillment === 'delivery' ? 'Delivery' : 'Recojo en el bar'}`,
        `*Pago:* ${submittedOrder.paymentMethod}`,
        '',
        `*Cliente:* ${submittedOrder.customerName}`,
        `*Celular:* ${submittedOrder.customerPhone}`,
        submittedOrder.fulfillment === 'delivery' ? `*Dirección:* ${submittedOrder.address}` : '',
      ].filter(Boolean).join('\n'),
    )}`
    : '#'

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#inicio" aria-label="The Black Cat - inicio">
          <span className="brand-mark" aria-hidden="true">✦</span>
          <span><strong>THE BLACK CAT</strong><small>ROCK BAR</small></span>
        </a>
        <button className="cart-button" type="button" aria-label="Ver carrito" onClick={() => setIsCartOpen(true)}>
          <span aria-hidden="true">🛒</span><span className="cart-count">{itemCount}</span>
        </button>
      </header>

      <section className="hero-section" id="inicio">
        <p className="eyebrow">ROCK, BURGERS &amp; COLD BEER</p>
        <h1>El sabor que<br />sube el volumen.</h1>
        <p className="hero-copy">Pide tus favoritos para delivery o recógelos en el bar.</p>
        <a className="primary-action" href="#menu">Ver el menú <span aria-hidden="true">↓</span></a>
        <div className="service-pills"><span>🛵 Delivery</span><span>✦ Recojo en el bar</span></div>
      </section>

      <section className="menu-preview" id="menu" aria-labelledby="menu-title">
        <div className="section-heading">
          <div><p className="eyebrow">ELIGE TU VENENO</p><h2 id="menu-title">Nuestro menú</h2></div>
          <span className="menu-item-count">{activeCategory.items.length} opciones</span>
        </div>
        <div className="category-tabs" role="tablist" aria-label="Categorías del menú">
          {menuCategories.map((category) => (
            <button className={category.id === activeCategoryId ? 'category-tab active' : 'category-tab'} type="button" role="tab"
              aria-selected={category.id === activeCategoryId} key={category.id} onClick={() => setActiveCategoryId(category.id)}>
              {category.name}
            </button>
          ))}
        </div>
        <div className="product-grid" role="tabpanel">
          {activeCategory.items.map((item, index) => (
            <article className={item.image ? 'product-card has-image' : 'product-card'} key={item.name}>
              {item.image && <img className="product-image" src={item.image} alt={item.name} />}
              <span className="product-number">{String(index + 1).padStart(2, '0')}</span>
              <h3>{item.name}</h3>
              <div className="product-footer">
                <p className="price">S/ {item.price.toFixed(2)}</p>
                <button className="add-button" type="button" onClick={() => addToCart(item)}>Añadir <span aria-hidden="true">＋</span></button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <footer><span>THE BLACK CAT · ROCK BAR</span><span>Delivery &amp; recojo</span></footer>

      {isCartOpen && (
        <div className="cart-layer" role="presentation" onClick={() => setIsCartOpen(false)}>
          <aside className="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="cart-title" onClick={(event) => event.stopPropagation()}>
            <div className="cart-header">
              <div><p className="eyebrow">TU PEDIDO</p><h2 id="cart-title">Carrito</h2></div>
              <button className="close-button" type="button" aria-label="Cerrar carrito" onClick={() => setIsCartOpen(false)}>×</button>
            </div>
            {cartItems.length === 0 ? (
              <div className="empty-cart"><span aria-hidden="true">🛒</span><h3>Tu carrito está vacío</h3><p>Elige algo del menú para comenzar tu pedido.</p></div>
            ) : (
              <>
                <div className="cart-items">
                  {cartItems.map((item) => (
                    <article className="cart-item" key={item.id}>
                      <div><h3>{item.name}</h3><p>S/ {item.price.toFixed(2)} c/u</p></div>
                      <div className="cart-item-actions">
                        <button className="remove-button" type="button" onClick={() => removeItem(item.id)}>Quitar</button>
                        <div className="quantity-control">
                          <button type="button" aria-label={`Quitar una unidad de ${item.name}`} onClick={() => changeQuantity(item.id, -1)}>−</button>
                          <span>{item.quantity}</span>
                          <button type="button" aria-label={`Añadir una unidad de ${item.name}`} onClick={() => changeQuantity(item.id, 1)}>＋</button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
                <div className="cart-summary">
                  <div><span>Subtotal</span><strong>S/ {subtotal.toFixed(2)}</strong></div>
                  <p>El delivery y método de pago se elegirán en el siguiente paso.</p>
                  <button className="checkout-button" type="button" onClick={startCheckout}>Continuar con el pedido</button>
                </div>
              </>
            )}
          </aside>
        </div>
      )}

      {isCheckoutOpen && (
        <div className="cart-layer" role="presentation" onClick={() => setIsCheckoutOpen(false)}>
          <aside className="cart-drawer checkout-drawer" role="dialog" aria-modal="true" aria-labelledby="checkout-title" onClick={(event) => event.stopPropagation()}>
            <div className="cart-header">
              <div><p className="eyebrow">CASI LISTO</p><h2 id="checkout-title">Checkout</h2></div>
              <button className="close-button" type="button" aria-label="Cerrar checkout" onClick={() => setIsCheckoutOpen(false)}>×</button>
            </div>
            {isOrderSubmitted ? (
              <div className="order-success">
                <span aria-hidden="true">✦</span><p className="eyebrow">PEDIDO REGISTRADO</p>
                <h3>¡Gracias por tu pedido!</h3>
                <p>Revisa el mensaje y envíalo por WhatsApp para que el bar reciba tu pedido.</p>
                <strong>Total de productos: S/ {submittedOrder?.subtotal.toFixed(2)}</strong>
                <a className="whatsapp-button" href={whatsappLink} target="_blank" rel="noreferrer">Enviar pedido por WhatsApp</a>
                <button className="checkout-button" type="button" onClick={() => { setCartItems([]); setIsCheckoutOpen(false) }}>Volver al menú</button>
              </div>
            ) : (
              <form className="checkout-form" onSubmit={(event) => {
                event.preventDefault()
                const formData = new FormData(event.currentTarget)
                setSubmittedOrder({
                  customerName: String(formData.get('name')),
                  customerPhone: String(formData.get('phone')),
                  fulfillment,
                  address: fulfillment === 'delivery' ? String(formData.get('address')) : '',
                  paymentMethod,
                  items: cartItems,
                  subtotal,
                })
                setIsOrderSubmitted(true)
              }}>
                <fieldset>
                  <legend>¿Cómo quieres recibirlo?</legend>
                  <div className="choice-grid">
                    <label className={fulfillment === 'delivery' ? 'choice-card active' : 'choice-card'}>
                      <input type="radio" name="fulfillment" value="delivery" checked={fulfillment === 'delivery'} onChange={() => setFulfillment('delivery')} />
                      <span>🛵</span><strong>Delivery</strong><small>Costo por confirmar</small>
                    </label>
                    <label className={fulfillment === 'pickup' ? 'choice-card active' : 'choice-card'}>
                      <input type="radio" name="fulfillment" value="pickup" checked={fulfillment === 'pickup'} onChange={() => setFulfillment('pickup')} />
                      <span>✦</span><strong>Recojo</strong><small>En The Black Cat</small>
                    </label>
                  </div>
                </fieldset>
                <fieldset>
                  <legend>Datos de contacto</legend>
                  <label>Nombre<input name="name" required placeholder="Tu nombre" autoComplete="name" /></label>
                  <label>Celular<input name="phone" required inputMode="tel" placeholder="999 999 999" autoComplete="tel" /></label>
                  {fulfillment === 'delivery' && <label>Dirección de delivery<textarea name="address" required placeholder="Calle, número, distrito y referencia" rows={3} /></label>}
                </fieldset>
                <fieldset>
                  <legend>Método de pago</legend>
                  <div className="payment-options">
                    {['Efectivo', 'Yape / Plin', 'Tarjeta'].map((method) => (
                      <label key={method} className={paymentMethod === method ? 'payment-option active' : 'payment-option'}>
                        <input type="radio" name="payment" value={method} checked={paymentMethod === method} onChange={() => setPaymentMethod(method)} />
                        {method}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="checkout-total"><span>Productos</span><strong>S/ {subtotal.toFixed(2)}</strong></div>
                <p className="checkout-disclaimer">El costo de delivery se confirmará según la zona. No se realizará ningún cobro en esta etapa.</p>
                <button className="checkout-button" type="submit">Registrar pedido</button>
                <button className="back-button" type="button" onClick={() => { setIsCheckoutOpen(false); setIsCartOpen(true) }}>← Volver al carrito</button>
              </form>
            )}
          </aside>
        </div>
      )}
    </main>
  )
}

export default App
