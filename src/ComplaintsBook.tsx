export function ComplaintsBook() {
  return (
    <main className="app-shell complaints-book-page">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Volver a The Black Cat">
          <span className="brand-mark" aria-hidden="true">✦</span>
          <span><strong>THE BLACK CAT</strong><small>ROCK BAR</small></span>
        </a>
      </header>

      <section className="complaints-book-content">
        <p className="eyebrow">THE BLACK CAT · ROCK BAR</p>
        <div className="complaints-book-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M5 4.75A2.75 2.75 0 0 1 7.75 2H20v16H7.75A2.75 2.75 0 0 0 5 20.75m0-16v16m0-16A2.75 2.75 0 0 1 7.75 2H20M9 6h7m-7 4h7m-7 4h4" /></svg>
        </div>
        <h1>Libro de Reclamaciones</h1>
        <p>Próximamente podrás registrar aquí tus reclamos o sugerencias.</p>
        <a className="back-button complaints-book-back" href="/">← Volver al inicio</a>
      </section>

      <footer><span>THE BLACK CAT · ROCK BAR</span><a className="complaints-book-link" href="/libro-de-reclamaciones"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.75A2.75 2.75 0 0 1 7.75 2H20v16H7.75A2.75 2.75 0 0 0 5 20.75m0-16v16m0-16A2.75 2.75 0 0 1 7.75 2H20M9 6h7m-7 4h7m-7 4h4" /></svg><span>Libro de Reclamaciones</span></a><span>Delivery &amp; recojo</span></footer>
    </main>
  )
}
