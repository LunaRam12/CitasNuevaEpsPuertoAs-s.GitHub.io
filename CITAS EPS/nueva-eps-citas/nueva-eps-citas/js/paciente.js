(function () {
  const $ = s => document.querySelector(s);
  const esc = EPS.esc;
  const cfg = EPS.getConfig();
  const form = $('#form'), fecha = $('#fecha');
  let horaSel = null;

  /* ---------- Carga inicial ---------- */
  $('#sede').textContent = cfg.sede;
  $('#mensaje').textContent = cfg.mensaje;

  const TIPOS = [['CC', 'Cédula de ciudadanía'], ['TI', 'Tarjeta de identidad'], ['RC', 'Registro civil'],
    ['CE', 'Cédula de extranjería'], ['PA', 'Pasaporte'], ['PEP', 'Permiso especial de permanencia'], ['PPT', 'Permiso por protección temporal']];
  $('#tipoDoc').innerHTML = '<option value="">Seleccione</option>' +
    TIPOS.map(t => `<option value="${t[0]}">${t[0]} – ${t[1]}</option>`).join('');

  $('#servicio').innerHTML = '<option value="">Seleccione el servicio</option>' +
    cfg.servicios.filter(s => s.activo).map(s => `<option value="${esc(s.id)}">${esc(s.nombre)}</option>`).join('');

  fecha.min = EPS.hoy();
  fecha.max = EPS.sumarDias(EPS.hoy(), cfg.horario.diasAdelante);

  /* ---------- Preguntas dinámicas (las define el administrador) ---------- */
  function preguntasDe(sid) {
    return cfg.preguntas.filter(q => q.servicio === 'all' || q.servicio === sid);
  }

  function renderPreguntas() {
    const sid = $('#servicio').value, box = $('#preguntas');
    const qs = preguntasDe(sid);
    if (!sid || !qs.length) { box.innerHTML = ''; return; }
    box.innerHTML = qs.map(q => {
      const req = q.obligatoria ? ' required' : '';
      const nm = `name="q_${esc(q.id)}"`;
      let inp;
      if (q.tipo === 'textarea') inp = `<textarea ${nm} rows="3" maxlength="500"${req}></textarea>`;
      else if (q.tipo === 'select') inp = `<select ${nm}${req}><option value="">Seleccione</option>${(q.opciones || []).map(o => `<option>${esc(o)}</option>`).join('')}</select>`;
      else if (q.tipo === 'yesno') inp = `<select ${nm}${req}><option value="">Seleccione</option><option>Sí</option><option>No</option></select>`;
      else inp = `<input type="text" ${nm} maxlength="200"${req}>`;
      return `<label class="campo ancho">${esc(q.texto)}${q.obligatoria ? '' : ' (opcional)'}${inp}</label>`;
    }).join('');
  }
  $('#servicio').addEventListener('change', renderPreguntas);

  /* ---------- Horarios ---------- */
  function renderFranjas() {
    const box = $('#franjas'), fe = fecha.value;
    horaSel = null;
    $('#horaElegida').textContent = '';
    if (!fe) { box.innerHTML = '<p class="nota">Elija una fecha para ver los horarios.</p>'; return; }
    if (fe < fecha.min || fe > fecha.max) {
      box.innerHTML = `<p class="aviso">Solo se puede agendar entre hoy y el ${EPS.fechaLarga(fecha.max)}.</p>`; return;
    }
    if (!EPS.diaAbierto(fe)) {
      const p = EPS.proximoDiaAbierto(fe);
      box.innerHTML = `<p class="aviso">Ese día no hay atención.${p ? ' El próximo día con cupos es el <b>' + EPS.fechaLarga(p) + '</b>.' : ''}</p>`;
      return;
    }
    const dsp = EPS.disponibilidad(fe);
    if (!dsp.some(x => x.libres > 0)) {
      const p = EPS.proximoDiaAbierto(EPS.sumarDias(fe, 1));
      box.innerHTML = `<p class="aviso">Ya no hay cupos ese día.${p ? ' El próximo día con cupos es el <b>' + EPS.fechaLarga(p) + '</b>.' : ''}</p>`;
      return;
    }
    box.innerHTML = dsp.map(x => `<button type="button" class="franja" data-h="${x.hora}" aria-pressed="false" ${x.libres > 0 ? '' : 'disabled'}>${x.hora}<small>${x.libres > 0 ? x.libres + (x.libres === 1 ? ' cupo' : ' cupos') : 'Sin cupo'}</small></button>`).join('');
  }
  fecha.addEventListener('change', renderFranjas);

  $('#franjas').addEventListener('click', e => {
    const b = e.target.closest('.franja');
    if (!b || b.disabled) return;
    document.querySelectorAll('.franja').forEach(x => x.setAttribute('aria-pressed', 'false'));
    b.setAttribute('aria-pressed', 'true');
    horaSel = b.dataset.h;
    $('#horaElegida').textContent = `Horario elegido: ${EPS.fechaLarga(fecha.value)}, ${horaSel}`;
  });

  /* ---------- Correo (EmailJS, opcional) ---------- */
  async function enviarCorreo(c) {
    const e = cfg.emailjs;
    if (!e.publicKey || !e.serviceId || !e.templateId || typeof emailjs === 'undefined') return false;
    try {
      await emailjs.send(e.serviceId, e.templateId, {
        to_email: c.paciente.correo, to_name: c.paciente.nombres, codigo: c.codigo,
        fecha: EPS.fechaLarga(c.fecha), hora: c.hora, servicio: c.servicioNombre, sede: 'Nueva EPS – ' + cfg.sede
      }, { publicKey: e.publicKey });
      return true;
    } catch (err) { console.error('EmailJS:', err); return false; }
  }

  /* ---------- Enviar el formulario ---------- */
  const msg = t => { $('#errores').textContent = t || ''; };

  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    msg('');
    if (!form.reportValidity()) return;
    if (!horaSel) { msg('Elija un horario para su cita.'); return; }

    const d = Object.fromEntries(new FormData(form));
    const t = s => String(s || '').trim();
    const sv = cfg.servicios.find(s => s.id === d.servicio);
    if (!sv) { msg('Elija un servicio.'); return; }

    const numDoc = t(d.numDoc).toUpperCase();
    const repetida = EPS.getCitas().some(c => c.fecha === d.fecha && c.servicio === d.servicio &&
      c.paciente.numDoc === numDoc && c.estado !== 'Cancelada');
    if (repetida) { msg('Ya tiene una cita para ese servicio en esa fecha. Use "Consultar o cancelar" si quiere cambiarla.'); return; }

    const edad = Number(d.edad);
    const cita = {
      fecha: d.fecha, hora: horaSel, servicio: sv.id, servicioNombre: sv.nombre,
      paciente: {
        nombres: t(d.nombres), apellidos: t(d.apellidos), tipoDoc: d.tipoDoc, numDoc, edad, sexo: d.sexo,
        celular: t(d.celular), correo: t(d.correo).toLowerCase(), barrio: t(d.barrio),
        regimen: d.regimen, condicion: d.condicion
      },
      prioritario: edad >= 60 || d.condicion !== 'Ninguna',
      respuestas: preguntasDe(sv.id).map(q => ({ id: q.id, pregunta: q.texto, respuesta: t(d['q_' + q.id]) }))
    };

    const r = EPS.crearCita(cita);
    if (!r.ok) { msg(r.error); renderFranjas(); return; }

    $('#btnAgendar').disabled = true;
    const enviado = await enviarCorreo(r.cita);
    mostrarConfirmacion(r.cita, enviado);
  });

  function mostrarConfirmacion(c, enviado) {
    form.hidden = true;
    $('#intro').hidden = true;
    $('#consulta').hidden = true;
    $('#confirmacion').hidden = false;
    $('#cCodigo').textContent = c.codigo;
    $('#cResumen').innerHTML = [
      ['Paciente', c.paciente.nombres + ' ' + c.paciente.apellidos],
      ['Documento', c.paciente.tipoDoc + ' ' + c.paciente.numDoc],
      ['Servicio', c.servicioNombre],
      ['Fecha', EPS.fechaLarga(c.fecha)],
      ['Hora', c.hora],
      ['Lugar', 'Nueva EPS – ' + cfg.sede]
    ].map(x => `<dt>${x[0]}</dt><dd>${esc(x[1])}</dd>`).join('');

    $('#cCorreo').textContent = enviado
      ? `Enviamos la confirmación a ${c.paciente.correo}.`
      : 'Tome nota del código o imprima esta página. Si quiere recibir el resumen en su correo, use el botón de abajo.';

    const cuerpo = `Cita Nueva EPS – ${cfg.sede}\nCódigo: ${c.codigo}\nPaciente: ${c.paciente.nombres} ${c.paciente.apellidos}\nServicio: ${c.servicioNombre}\nFecha: ${EPS.fechaLarga(c.fecha)}\nHora: ${c.hora}\nLleve su documento de identidad.`;
    $('#cMailto').href = `mailto:${encodeURIComponent(c.paciente.correo)}?subject=${encodeURIComponent('Su cita Nueva EPS ' + c.codigo)}&body=${encodeURIComponent(cuerpo)}`;
    window.scrollTo({ top: 0 });
  }

  /* ---------- Consultar o cancelar ---------- */
  $('#formConsulta').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const cod = String(fd.get('codigo')).trim().toUpperCase();
    const doc = String(fd.get('numDoc')).trim().toUpperCase();
    const box = $('#resConsulta');
    const c = EPS.getCitas().find(x => x.codigo === cod && x.paciente.numDoc === doc);
    if (!c) { box.innerHTML = '<p class="error">No encontramos una cita con esos datos. Revise el código y el documento.</p>'; return; }
    const puedeCancelar = c.estado === 'Agendada' && c.fecha >= EPS.hoy();
    box.innerHTML = `
      <dl class="resumen">
        <dt>Estado</dt><dd>${esc(c.estado)}</dd>
        <dt>Paciente</dt><dd>${esc(c.paciente.nombres + ' ' + c.paciente.apellidos)}</dd>
        <dt>Servicio</dt><dd>${esc(c.servicioNombre)}</dd>
        <dt>Fecha</dt><dd>${esc(EPS.fechaLarga(c.fecha))}</dd>
        <dt>Hora</dt><dd>${esc(c.hora)}</dd>
      </dl>
      ${puedeCancelar ? '<button class="btn peligro" id="btnCancelar">Cancelar esta cita</button>' : ''}`;
    const bc = $('#btnCancelar');
    if (bc) bc.onclick = () => {
      if (!confirm('¿Seguro que desea cancelar la cita? El cupo quedará libre para otra persona.')) return;
      EPS.cambiarEstado(c.id, 'Cancelada');
      box.innerHTML = '<p class="exito">Su cita fue cancelada.</p>';
      renderFranjas();
    };
  });
})();
