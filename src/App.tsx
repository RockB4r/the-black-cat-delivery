import { useMemo, useRef, useState } from 'react'
import menuData from './data/menu.json'
import type { MenuCategory, MenuItem } from './data/types'
import './App.css'

type CartItem = { id: string; name: string; price: number; quantity: number; note?: string; style?: string; sauce?: string }
type SubmittedOrder = {
  orderId?: string
  customerName: string
  customerPhone: string
  customerEmail: string
  fulfillment: 'delivery' | 'pickup'
  address: string
  paymentMethod: string
  items: CartItem[]
  subtotal: number
}
type CulqiChargeResponse = {
  approved: boolean
  message?: string
  chargeId?: string
  orderId?: string
}
const menuCategories = menuData as MenuCategory[]

function App() {
  const [activeCategoryId, setActiveCategoryId] = useState(menuCategories[0].id)
  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const [isCartOpen, setIsCartOpen] = useState(false)
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false)
  const [fulfillment, setFulfillment] = useState<'delivery' | 'pickup'>('delivery')
  const [paymentMethod, setPaymentMethod] = useState('Efectivo')
  const [isOrderSubmitted, setIsOrderSubmitted] = useState(false)
  const [submittedOrder, setSubmittedOrder] = useState<SubmittedOrder | null>(null)
  const [selectedProduct, setSelectedProduct] = useState<MenuItem | null>(null)
  const [productNote, setProductNote] = useState('')
  const [selectedStyle, setSelectedStyle] = useState('')
  const [selectedSauce, setSelectedSauce] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [receiptType, setReceiptType] = useState<'boleta' | 'factura'>('boleta')
  const [dni, setDni] = useState('')
  const [ruc, setRuc] = useState('')
  const [culqiMessage, setCulqiMessage] = useState('')
  const [isProcessingPayment, setIsProcessingPayment] = useState(false)
  const checkoutFormRef = useRef<HTMLFormElement>(null)
  const activeCategory = menuCategories.find(({ id }) => id === activeCategoryId) ?? menuCategories[0]
  const isCraftBeerCategory = activeCategory.id === 'cervezas-artesanales'
  const itemCount = cartItems.reduce((total, item) => total + item.quantity, 0)
  const subtotal = useMemo(() => cartItems.reduce((total, item) => total + item.price * item.quantity, 0), [cartItems])
  const hasValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail.trim())
  const canPayWithCulqi = cartItems.length > 0 && subtotal > 0 && hasValidEmail
  const isCashPayment = paymentMethod === 'Efectivo'
  const culqiPublicKey = import.meta.env.VITE_CULQI_PUBLIC_KEY

  const getOrderPayload = () => {
    const form = checkoutFormRef.current
    if (!form || !form.reportValidity()) return null
    const formData = new FormData(form)
    if (receiptType === 'factura' && !/^\d{11}$/.test(ruc)) {
      setCulqiMessage('Para Factura ingresa un RUC válido de 11 dígitos.')
      return null
    }
    if (receiptType === 'boleta' && dni && !/^\d{8}$/.test(dni)) {
      setCulqiMessage('El DNI debe tener exactamente 8 dígitos.')
      return null
    }
    return {
      customer: String(formData.get('name')).trim(),
      phone: String(formData.get('phone')).trim(),
      email: customerEmail.trim(),
      address: fulfillment === 'delivery' ? String(formData.get('address')).trim() : '',
      fulfillment,
      receiptType,
      ...(receiptType === 'boleta' && dni ? { dni } : {}),
      ...(receiptType === 'factura' ? { ruc } : {}),
      items: cartItems.map(({ name, quantity, note, style, sauce }) => ({ name, quantity, note, style, sauce })),
    }
  }

  const openProductModal = (item: MenuItem) => {
    setSelectedProduct(item)
    setProductNote('')
    setSelectedStyle(item.styles?.length === 1 ? item.styles[0].name : '')
    setSelectedSauce(item.sauces?.length === 1 ? item.sauces[0].name : '')
  }

  const addToCart = (item: { name: string; price: number }, note = '', style = '', sauce = '') => {
    const trimmedNote = note.trim()
    const id = [activeCategory.id, item.name, style, sauce, trimmedNote].join('-')
    setCartItems((current) => {
      const existing = current.find((cartItem) => cartItem.id === id)
      return existing
        ? current.map((cartItem) => cartItem.id === id ? { ...cartItem, quantity: cartItem.quantity + 1 } : cartItem)
        : [...current, { ...item, id, style: style || undefined, sauce: sauce || undefined, note: trimmedNote || undefined, quantity: 1 }]
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

  const handleCulqiAction = async (culqi: CulqiCheckoutInstance) => {
    if (culqi.token) {
      culqi.close()
      const order = getOrderPayload()
      if (!order) return
      setIsProcessingPayment(true)
      setCulqiMessage('Procesando pago...')

      try {
        const response = await fetch('/.netlify/functions/create-culqi-charge', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            token: culqi.token.id,
            amount: Math.round(subtotal * 100),
            currency: 'PEN',
            ...order,
            email: order.email,
            description: `Pedido The Black Cat Rock Bar · ${itemCount} producto(s)`,
            items: order.items,
          }),
        })
        const result = await response.json() as CulqiChargeResponse

        if (!response.ok || !result.approved) {
          setCulqiMessage(result.message ?? 'El pago no pudo procesarse. Tu carrito se conserva intacto.')
          return
        }

        setCulqiMessage(`Pago aprobado. Pedido recibido por The Black Cat${result.orderId ? ` · Código: ${result.orderId}` : ''}.`)
      } catch {
        setCulqiMessage('No fue posible conectar con el servicio de pago. Tu carrito se conserva intacto.')
      } finally {
        setIsProcessingPayment(false)
      }
      return
    }

    if (culqi.order) {
      culqi.close()
      setCulqiMessage('Pago en proceso de confirmación. El pedido será confirmado cuando Culqi notifique al backend.')
      return
    }

    console.error('Error de Culqi:', culqi.error)
    setCulqiMessage('No se pudo iniciar el pago. Revisa los datos e inténtalo nuevamente.')
  }

  const openCulqiCheckout = async () => {
    if (!canPayWithCulqi) return
    const orderPayload = getOrderPayload()
    if (!orderPayload) return

    if (!culqiPublicKey) {
      setCulqiMessage('Falta configurar la llave pública de Culqi para este entorno.')
      return
    }

    if (!window.CulqiCheckout) {
      setCulqiMessage('El Checkout de Culqi aún no terminó de cargar. Inténtalo nuevamente en unos segundos.')
      return
    }

    setCulqiMessage('')
    const amountInCents = Math.round(subtotal * 100)
    let backendOrderId: string | undefined
    {
      setIsProcessingPayment(true)
      try {
        const response = await fetch('/.netlify/functions/create-culqi-order', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...orderPayload, amount: amountInCents, currency: 'PEN' }),
        })
        const result = await response.json() as { orderId?: string; culqiOrderId?: string; message?: string }
        if (!response.ok || !result.orderId || !result.culqiOrderId) { setCulqiMessage(result.message ?? 'No fue posible generar la orden de pago.'); return }
        backendOrderId = result.culqiOrderId
        setCulqiMessage(`Pago en proceso de confirmación · Pedido: ${result.orderId}`)
      } catch { setCulqiMessage('No fue posible conectar con el servicio de pago.'); return } finally { setIsProcessingPayment(false) }
    }
    const settings: CulqiCheckoutSettings = {
      title: 'The Black Cat Rock Bar',
      currency: 'PEN',
      amount: amountInCents,
    }

    // El backend seguro asignará este Order ID en la próxima etapa; no se usa uno fijo en el frontend.
    if (backendOrderId) settings.order = backendOrderId

    const culqi = new window.CulqiCheckout(culqiPublicKey, {
      settings,
      client: { email: customerEmail.trim() },
      options: {
        lang: 'es',
        modal: true,
        paymentMethods: {
          tarjeta: true,
          yape: true,
          billetera: true,
          bancaMovil: true,
          agente: true,
          cuotealo: true,
        },
        paymentMethodsSort: ['tarjeta', 'yape', 'billetera', 'bancaMovil', 'agente', 'cuotealo'],
      },
      appearance: { theme: 'default', menuType: 'sliderTop' },
    })

    culqi.culqi = () => { void handleCulqiAction(culqi) }
    culqi.open()
  }
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
        <h1>El Templo del Rock<br />y del espíritu Rebelde.</h1>
        <p className="hero-copy">Pide tus favoritos para delivery o recógelos en el bar.</p>
        <a className="primary-action" href="#menu">Ver el menú <span aria-hidden="true">↓</span></a>
        <div className="service-pills"><span>🛵 Delivery</span><span>✦ Recojo en el bar</span></div>
      </section>

      <section className="menu-preview" id="menu" aria-labelledby="menu-title">
        <div className="section-heading">
          <div><p className="eyebrow">TONIGHT'S LINE UP</p><h2 id="menu-title">Nuestro Repertorio</h2></div>
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
            <article
              className={item.image ? 'product-card has-image' : 'product-card'}
              key={item.name}
              role="button"
              tabIndex={0}
              aria-label={'Ver detalles de ' + item.name}
              onClick={() => openProductModal(item)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  openProductModal(item)
                }
              }}
            >
              {item.image && <img className="product-image" src={item.image} alt={item.name} />}
              <span className="product-number">{String(index + 1).padStart(2, '0')}</span>
              <h3>{item.name}</h3>
              <div className="product-footer">
                <p className="price">{item.styles ? `Desde S/ ${Math.min(...item.styles.map((style) => style.price)).toFixed(2)}` : `S/ ${item.price.toFixed(2)}`}</p>
                <button className="add-button" type="button" onClick={(event) => { event.stopPropagation(); item.styles || item.sauces ? openProductModal(item) : addToCart(item) }}>{item.styles || item.sauces ? 'Escoger' : 'Añadir'} <span aria-hidden="true">＋</span></button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {selectedProduct && (
        <div className="product-modal-layer" role="presentation" onClick={() => setSelectedProduct(null)}>
          <section className="product-modal" role="dialog" aria-modal="true" aria-labelledby="product-modal-title" onClick={(event) => event.stopPropagation()}>
            <button className="close-button product-modal-close" type="button" aria-label="Cerrar detalles del producto" onClick={() => setSelectedProduct(null)}>×</button>
            {selectedProduct.image ? (
              <img className="product-modal-image" src={selectedProduct.image} alt={selectedProduct.name} />
            ) : (
              <div className="product-modal-image product-modal-image-fallback" aria-hidden="true">✦</div>
            )}
            <div className="product-modal-content">
              <p className="eyebrow">THE BLACK CAT MENU</p>
              <h2 id="product-modal-title">{selectedProduct.name}</h2>
              <p className="modal-price">{selectedProduct.styles ? `Desde S/ ${Math.min(...selectedProduct.styles.map((style) => style.price)).toFixed(2)}` : `S/ ${selectedProduct.price.toFixed(2)}`}</p>
              {selectedProduct.styles && <label className="product-style-field"><span>Escoge tu estilo</span><select value={selectedStyle} onChange={(event) => setSelectedStyle(event.target.value)} required aria-required="true"><option value="" disabled>Selecciona un estilo</option>{selectedProduct.styles.map((style) => <option key={style.name} value={style.name}>{style.name} · S/ {style.price.toFixed(2)}</option>)}</select></label>}
              {selectedProduct.sauces && <label className="product-style-field"><span>Escoge tu salsa</span><select value={selectedSauce} onChange={(event) => setSelectedSauce(event.target.value)} required aria-required="true"><option value="" disabled>Selecciona una salsa</option>{selectedProduct.sauces.map((sauce) => <option key={sauce.name} value={sauce.name}>{sauce.name}</option>)}</select></label>}
              {!isCraftBeerCategory && <div className="ingredients">
                <h3>Ingredientes</h3>
                <p>{selectedProduct.ingredients ?? 'Ingredientes por confirmar.'}</p>
              </div>}
              <label className="product-note-field">
                <span>Indicación para cocina</span>
                <textarea
                  value={productNote}
                  onChange={(event) => setProductNote(event.target.value)}
                  maxLength={150}
                  rows={3}
                  placeholder="¿Alguna indicación para cocina?"
                />
                <small>{productNote.length}/150</small>
              </label>
              <button className="add-button modal-add-button" type="button" disabled={Boolean((selectedProduct.styles && !selectedStyle) || (selectedProduct.sauces && !selectedSauce))} onClick={() => { const style = selectedProduct.styles?.find((item) => item.name === selectedStyle); addToCart({ name: selectedProduct.name, price: style?.price ?? selectedProduct.price }, productNote, selectedStyle, selectedSauce); setProductNote(''); setSelectedStyle(''); setSelectedSauce(''); setSelectedProduct(null) }}>
                Añadir al pedido <span aria-hidden="true">＋</span>
              </button>
            </div>
          </section>
        </div>
      )}

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
                      <div>
                        <h3>{item.name}</h3>
                        {item.style && <p className="cart-item-style">Estilo: {item.style}</p>}
                        {item.sauce && <p className="cart-item-style">Salsa: {item.sauce}</p>}
                        {item.note && <p className="cart-item-note">Nota: {item.note}</p>}
                        <p>S/ {item.price.toFixed(2)} c/u</p>
                      </div>
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
                <p>Tu pedido fue recibido por The Black Cat. La tienda fue notificada automáticamente.</p>
                {submittedOrder?.orderId && <strong>Código de pedido: {submittedOrder.orderId}</strong>}
                <strong>Total de productos: S/ {submittedOrder?.subtotal.toFixed(2)}</strong>
                <button className="checkout-button" type="button" onClick={() => { setCartItems([]); setIsCheckoutOpen(false) }}>Volver al menú</button>
              </div>
            ) : (
              <form className="checkout-form" ref={checkoutFormRef} onSubmit={async (event) => {
                event.preventDefault()
                const formData = new FormData(event.currentTarget)
                const orderPayload = getOrderPayload()
                if (!orderPayload) return
                setIsProcessingPayment(true)
                try {
                  const response = await fetch('/.netlify/functions/create-cash-order', {
                    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(orderPayload),
                  })
                  const result = await response.json() as { orderId?: string }
                  if (!response.ok || !result.orderId) { setCulqiMessage('No fue posible registrar el pedido. Inténtalo nuevamente.'); return }
                  setSubmittedOrder({
                    orderId: result.orderId,
                    customerName: String(formData.get('name')),
                    customerPhone: String(formData.get('phone')),
                    customerEmail: String(formData.get('email')),
                    fulfillment,
                    address: fulfillment === 'delivery' ? String(formData.get('address')) : '',
                    paymentMethod,
                    items: cartItems,
                    subtotal,
                  })
                } catch { setCulqiMessage('No fue posible registrar el pedido. Inténtalo nuevamente.'); return } finally { setIsProcessingPayment(false) }
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
                  <label>Correo electrónico<input name="email" type="email" required value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} placeholder="tu@email.com" autoComplete="email" /></label>
                  {fulfillment === 'delivery' && <label>Dirección de delivery<textarea name="address" required placeholder="Calle, número, distrito y referencia" rows={3} /></label>}
                  <div className="receipt-fields">
                    <span>Comprobante</span>
                    <div className="payment-options">
                      <label className={receiptType === 'boleta' ? 'payment-option active' : 'payment-option'}>
                        <input type="radio" name="receiptType" checked={receiptType === 'boleta'} onChange={() => { setReceiptType('boleta'); setRuc('') }} /> Boleta
                      </label>
                      <label className={receiptType === 'factura' ? 'payment-option active' : 'payment-option'}>
                        <input type="radio" name="receiptType" checked={receiptType === 'factura'} onChange={() => { setReceiptType('factura'); setDni('') }} /> Factura
                      </label>
                    </div>
                    {receiptType === 'boleta' ? (
                      <label>DNI (opcional)<input name="dni" inputMode="numeric" maxLength={8} value={dni} onChange={(event) => setDni(event.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="12345678" /></label>
                    ) : (
                      <label>RUC<input name="ruc" inputMode="numeric" required maxLength={11} value={ruc} onChange={(event) => setRuc(event.target.value.replace(/\D/g, '').slice(0, 11))} placeholder="20123456789" /></label>
                    )}
                  </div>
                </fieldset>
                <fieldset>
                  <legend>Método de pago</legend>
                  <div className="payment-options">
                    {['Efectivo', 'Pagar con Culqi'].map((method) => (
                      <label key={method} className={paymentMethod === method ? 'payment-option active' : 'payment-option'}>
                        <input type="radio" name="payment" value={method} checked={paymentMethod === method} onChange={() => setPaymentMethod(method)} />
                        {method}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="checkout-total"><span>Productos</span><strong>S/ {subtotal.toFixed(2)}</strong></div>
                <p className="checkout-disclaimer">El costo de delivery se confirmará según la zona. No se realizará ningún cobro en esta etapa.</p>
                {!isCashPayment && <button className="culqi-button" type="button" disabled={!canPayWithCulqi || isProcessingPayment} onClick={() => { void openCulqiCheckout() }}>
                  {isProcessingPayment ? 'Procesando pago...' : 'Pagar con Culqi'}
                </button>}
                {!hasValidEmail && <p className="culqi-help">Ingresa un correo electrónico válido para pagar con Culqi.</p>}
                {culqiMessage && <p className="culqi-message" role="status">{culqiMessage}</p>}
                {isCashPayment && <button className="checkout-button" type="submit">Registrar pedido</button>}
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
