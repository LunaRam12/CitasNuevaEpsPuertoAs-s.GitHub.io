/* ============================================================
   Capa de datos compartida (usa localStorage del navegador).
   La usan index.html (pacientes) y admin.html (administrador).
   ============================================================ */
const EPS = (() => {
  const K_CFG = 'neps_config_v1';
  const K_CITAS = 'neps_citas_v1';

  const DEF = {
    sede: 'Puerto Asís, Putumayo',
    mensaje: 'Complete el formulario, elija su horario y reciba su código de cita. Preséntelo el día de la atención con su documento de identidad.',
    servicios: ['Medicina general', 'Odontología', 'Pediatría', 'Ginecología', 'Laboratorio clínico',
      'Vacunación', 'Entrega de medicamentos', 'Autorizaciones y trámites']
      .map((n, i) => ({ id: 's' + (i + 1), nombre: n, activo: true })),
    horario: {
      dias: [1, 2, 3, 4, 5],          // 0=domingo ... 6=sábado
      inicio: '07:30', fin: '16:00',
      almuerzoIni: '12:00', almuerzoFin: '14:00',
      duracion: 20,                   // minutos por cita
      cupos: 2,                       // citas simultáneas por franja
      diasAdelante: 30,               // hasta cuántos días a futuro se puede agendar
      bloqueados: []                  // fechas sin atención (festivos, etc.) 'YYYY-MM-DD'
    },
    preguntas: [
      { id: 'q1', texto: 'Describa brevemente el motivo de su cita', tipo: 'textarea', opciones: [], obligatoria: true, servicio: 'all' },
      { id: 'q2', texto: '¿Es la primera vez que solicita este servicio?', tipo: 'yesno', opciones: [], obligatoria: true, servicio: 'all' },
      { id: 'q3', texto: '¿Necesita apoyo para movilizarse o un acompañante?', tipo: 'yesno', opciones: [], obligatoria: false, servicio: 'all' }
    ],
    admin: { clave: 'admin123' },
    emailjs: { publicKey: '', serviceId: '', templateId: '' }
  };

  const leer = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const guardar = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  function getConfig() {
    const s = leer(K_CFG, {});
    const c = Object.assign({}, JSON.parse(JSON.stringify(DEF)), s);
    c.horario = Object.assign({}, DEF.horario, s.horario || {});
    c.emailjs = Object.assign({}, DEF.emailjs, s.emailjs || {});
    c.admin = Object.assign({}, DEF.admin, s.admin || {});
    return c;
  }
  const saveConfig = c => guardar(K_CFG, c);
  const getCitas = () => leer(K_CITAS, []);
  const saveCitas = c => guardar(K_CITAS, c);

  /* ---------- Fechas y horas ---------- */
  const fechaStr = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const parseF = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const hoy = () => fechaStr(new Date());
  const sumarDias = (f, n) => { const d = parseF(f); d.setDate(d.getDate() + n); return fechaStr(d); };
  const fechaLarga = f => parseF(f).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const aMin = h => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };
  const aHora = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  /* ---------- Agenda ---------- */
  function diaAbierto(f) {
    const h = getConfig().horario;
    return h.dias.includes(parseF(f).getDay()) && !h.bloqueados.includes(f);
  }

  function franjas(f) {
    const h = getConfig().horario;
    if (!diaAbierto(f)) return [];
    const out = [], ai = aMin(h.almuerzoIni), af = aMin(h.almuerzoFin);
    for (let m = aMin(h.inicio); m + h.duracion <= aMin(h.fin); m += h.duracion) {
      const fin = m + h.duracion;
      if (h.almuerzoIni && h.almuerzoFin && m < af && fin > ai) continue; // se cruza con el almuerzo
      out.push(aHora(m));
    }
    return out;
  }

  function disponibilidad(f) {
    const cupos = getConfig().horario.cupos;
    const citas = getCitas().filter(c => c.fecha === f && c.estado !== 'Cancelada');
    const ahora = new Date(), ahoraMin = ahora.getHours() * 60 + ahora.getMinutes();
    return franjas(f).map(hora => {
      const ocupadas = citas.filter(c => c.hora === hora).length;
      const pasada = f === hoy() && aMin(hora) <= ahoraMin;
      return { hora, libres: pasada ? 0 : Math.max(cupos - ocupadas, 0) };
    });
  }

  function proximoDiaAbierto(desde) {
    const max = sumarDias(hoy(), getConfig().horario.diasAdelante);
    for (let i = 0; i < 90; i++) {
      const f = sumarDias(desde, i);
      if (f > max) return null;
      if (f >= hoy() && diaAbierto(f) && disponibilidad(f).some(x => x.libres > 0)) return f;
    }
    return null;
  }

  function generarCodigo(f) {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', existentes = getCitas().map(c => c.codigo);
    let cod;
    do {
      cod = 'NE-' + f.replace(/-/g, '') + '-' + Array.from({ length: 4 }, () => abc[Math.floor(Math.random() * abc.length)]).join('');
    } while (existentes.includes(cod));
    return cod;
  }

  function crearCita(c) {
    const fr = disponibilidad(c.fecha).find(x => x.hora === c.hora);
    if (!fr || fr.libres < 1) return { ok: false, error: 'Ese horario ya no está disponible. Elija otro.' };
    const citas = getCitas();
    c.id = 'c' + Date.now() + Math.random().toString(36).slice(2, 6);
    c.codigo = generarCodigo(c.fecha);
    c.estado = 'Agendada';
    c.creada = new Date().toISOString();
    citas.push(c);
    saveCitas(citas);
    return { ok: true, cita: c };
  }

  function cambiarEstado(id, estado) {
    const citas = getCitas(), c = citas.find(x => x.id === id);
    if (c) { c.estado = estado; saveCitas(citas); }
  }

  return { DEF, getConfig, saveConfig, getCitas, saveCitas, hoy, sumarDias, fechaLarga, fechaStr, parseF, esc,
    diaAbierto, franjas, disponibilidad, proximoDiaAbierto, crearCita, cambiarEstado };
})();
