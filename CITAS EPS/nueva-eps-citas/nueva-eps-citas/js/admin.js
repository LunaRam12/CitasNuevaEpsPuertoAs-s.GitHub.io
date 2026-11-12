(function () {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = EPS.esc;
  let cfg = EPS.getConfig();
  const guardar = () => EPS.saveConfig(cfg);
  const ESTADOS = ['Agendada', 'Atendida', 'No asistió', 'Cancelada'];

  /* ---------- Acceso ---------- */
  function entrar() { $('#login').hidden = true; $('#app').hidden = false; iniciar(); }
  if (sessionStorage.getItem('neps_admin') === '1') entrar();
  $('#formLogin').addEventListener('submit', e => {
    e.preventDefault();
    if ($('#clave').value === cfg.admin.clave) { sessionStorage.setItem('neps_admin', '1'); entrar(); }
    else $('#errLogin').textContent = 'Clave incorrecta.';
  });
  $('#salir').onclick = () => { sessionStorage.removeItem('neps_admin'); location.reload(); };

  /* ---------- Pestañas ---------- */
  const render = { agenda: renderAgenda, servicios: renderServicios, horario: renderHorario, preguntas: renderPreguntas, qr: renderQR, ajustes: renderAjustes };
  function abrirTab(nombre) {
    $$('.tab').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === nombre));
    $$('.panel').forEach(p => p.hidden = p.id !== 'tab-' + nombre);
    cfg = EPS.getConfig();
    render[nombre]();
  }
  $$('.tab').forEach(b => b.onclick = () => abrirTab(b.dataset.tab));

  function iniciar() {
    $('#agFecha').value = EPS.hoy();
    $('#rgDesde').value = EPS.hoy();
    $('#rgHasta').value = EPS.sumarDias(EPS.hoy(), 7);
    abrirTab('agenda');
  }

  /* =========================================================
     AGENDA
     ========================================================= */
  function renderAgenda() {
    const fe = $('#agFecha').value || EPS.hoy();
    const citas = EPS.getCitas().filter(c => c.fecha === fe).sort((a, b) => a.hora.localeCompare(b.hora));
    const activas = citas.filter(c => c.estado !== 'Cancelada').length;
    const capacidad = EPS.franjas(fe).length * cfg.horario.cupos;
    $('#stats').innerHTML =
      `<div><b>${activas}</b>citas activas</div><div><b>${Math.max(capacidad - activas, 0)}</b>cupos libres</div>` +
      `<div><b>${citas.filter(c => c.estado === 'Atendida').length}</b>atendidas</div>` +
      `<div><b>${citas.filter(c => c.estado === 'Cancelada').length}</b>canceladas</div>`;
    $('#tbAgenda').innerHTML = citas.length ? citas.map(c => `
      <tr>
        <td>${esc(c.hora)}</td>
        <td>${esc(c.paciente.nombres + ' ' + c.paciente.apellidos)} ${c.prioritario ? '<span class="tag">Prioritario</span>' : ''}</td>
        <td>${esc(c.paciente.tipoDoc + ' ' + c.paciente.numDoc)}</td>
        <td>${esc(c.servicioNombre)}</td>
        <td>${esc(c.paciente.celular)}</td>
        <td><select class="sola" data-estado="${esc(c.id)}">${ESTADOS.map(s => `<option${s === c.estado ? ' selected' : ''}>${s}</option>`).join('')}</select></td>
        <td><button class="btn sec chico" data-ver="${esc(c.id)}">Ver</button></td>
      </tr>`).join('') : '<tr><td colspan="7" class="nota">No hay citas para este día.</td></tr>';
  }
  $('#agFecha').addEventListener('change', renderAgenda);

  $('#tbAgenda').addEventListener('change', e => {
    const id = e.target.dataset.estado;
    if (id) { EPS.cambiarEstado(id, e.target.value); renderAgenda(); }
  });
  $('#tbAgenda').addEventListener('click', e => {
    const id = e.target.dataset.ver;
    if (!id) return;
    const c = EPS.getCitas().find(x => x.id === id);
    if (!c) return;
    const p = c.paciente;
    $('#detalle').innerHTML = `
      <h2>${esc(p.nombres + ' ' + p.apellidos)}</h2>
      <dl class="resumen">
        <dt>Código</dt><dd>${esc(c.codigo)}</dd>
        <dt>Fecha y hora</dt><dd>${esc(EPS.fechaLarga(c.fecha))}, ${esc(c.hora)}</dd>
        <dt>Servicio</dt><dd>${esc(c.servicioNombre)}</dd>
        <dt>Documento</dt><dd>${esc(p.tipoDoc + ' ' + p.numDoc)}</dd>
        <dt>Edad / sexo</dt><dd>${esc(p.edad)} años, ${esc(p.sexo)}</dd>
        <dt>Celular</dt><dd>${esc(p.celular)}</dd>
        <dt>Correo</dt><dd>${esc(p.correo)}</dd>
        <dt>Barrio o vereda</dt><dd>${esc(p.barrio)}</dd>
        <dt>Régimen</dt><dd>${esc(p.regimen)}</dd>
        <dt>Condición especial</dt><dd>${esc(p.condicion)}</dd>
        ${c.respuestas.map(r => `<dt>${esc(r.pregunta)}</dt><dd>${esc(r.respuesta || '—')}</dd>`).join('')}
      </dl>
      <div class="acciones"><button class="btn" onclick="document.getElementById('detalle').close()">Cerrar</button></div>`;
    $('#detalle').showModal();
  });

  /* ---------- Exportar a Excel ---------- */
  function filas(citas) {
    return citas.map(c => {
      const p = c.paciente;
      const o = {
        'Fecha': c.fecha, 'Hora': c.hora, 'Código': c.codigo, 'Servicio': c.servicioNombre,
        'Nombres': p.nombres, 'Apellidos': p.apellidos, 'Tipo documento': p.tipoDoc, 'Número documento': p.numDoc,
        'Edad': p.edad, 'Sexo': p.sexo, 'Celular': p.celular, 'Correo': p.correo, 'Barrio o vereda': p.barrio,
        'Régimen': p.regimen, 'Condición especial': p.condicion, 'Prioritario': c.prioritario ? 'Sí' : 'No', 'Estado': c.estado
      };
      c.respuestas.forEach(r => { o[r.pregunta] = r.respuesta; });
      return o;
    });
  }
  function hoja(citas) {
    const ws = XLSX.utils.json_to_sheet(filas(citas));
    const cols = Object.keys(filas(citas)[0] || {});
    ws['!cols'] = cols.map(k => ({ wch: Math.min(Math.max(k.length + 2, 12), 40) }));
    return ws;
  }
  const ordenar = l => l.sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));

  $('#expDia').onclick = () => {
    const fe = $('#agFecha').value;
    const citas = ordenar(EPS.getCitas().filter(c => c.fecha === fe));
    if (!citas.length) { alert('No hay citas ese día.'); return; }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, hoja(citas), fe);
    XLSX.writeFile(wb, `Agenda_NuevaEPS_${fe}.xlsx`);
  };
  $('#expRango').onclick = () => {
    const d = $('#rgDesde').value, h = $('#rgHasta').value;
    if (!d || !h || d > h) { alert('Revise el rango de fechas.'); return; }
    const todas = EPS.getCitas().filter(c => c.fecha >= d && c.fecha <= h);
    const dias = [...new Set(todas.map(c => c.fecha))].sort();
    if (!dias.length) { alert('No hay citas en ese rango.'); return; }
    const wb = XLSX.utils.book_new();
    dias.slice(0, 100).forEach(f => XLSX.utils.book_append_sheet(wb, hoja(ordenar(todas.filter(c => c.fecha === f))), f));
    XLSX.writeFile(wb, `Agenda_NuevaEPS_${d}_a_${h}.xlsx`);
  };

  /* =========================================================
     SERVICIOS
     ========================================================= */
  function renderServicios() {
    $('#listaServicios').innerHTML = cfg.servicios.map((s, i) => `
      <div class="item">
        <input type="text" value="${esc(s.nombre)}" data-i="${i}" data-f="nombre" aria-label="Nombre del servicio">
        <label class="chk"><input type="checkbox" data-i="${i}" data-f="activo"${s.activo ? ' checked' : ''}> Activo</label>
        <button class="btn peligro chico" data-del="${i}">Eliminar</button>
      </div>`).join('') || '<p class="nota">Aún no hay servicios.</p>';
  }
  $('#listaServicios').addEventListener('change', e => {
    const i = e.target.dataset.i; if (i == null) return;
    if (e.target.dataset.f === 'nombre') {
      const v = e.target.value.trim();
      if (!v) { renderServicios(); return; }
      cfg.servicios[i].nombre = v;
    } else cfg.servicios[i].activo = e.target.checked;
    guardar();
  });
  $('#listaServicios').addEventListener('click', e => {
    const i = e.target.dataset.del; if (i == null) return;
    const s = cfg.servicios[i];
    if (!confirm(`¿Eliminar "${s.nombre}"? Las citas ya agendadas se conservan.`)) return;
    cfg.preguntas.forEach(q => { if (q.servicio === s.id) q.servicio = 'all'; });
    cfg.servicios.splice(i, 1);
    guardar(); renderServicios();
  });
  $('#addServicio').onclick = () => {
    const v = $('#nuevoServicio').value.trim();
    if (!v) return;
    cfg.servicios.push({ id: 's' + Date.now(), nombre: v, activo: true });
    $('#nuevoServicio').value = '';
    guardar(); renderServicios();
  };

  /* =========================================================
     HORARIOS
     ========================================================= */
  const DIAS = [[1, 'Lunes'], [2, 'Martes'], [3, 'Miércoles'], [4, 'Jueves'], [5, 'Viernes'], [6, 'Sábado'], [0, 'Domingo']];
  function renderHorario() {
    const h = cfg.horario;
    $('#dias').innerHTML = DIAS.map(d => `<label><input type="checkbox" value="${d[0]}"${h.dias.includes(d[0]) ? ' checked' : ''}> ${d[1]}</label>`).join('');
    $('#hInicio').value = h.inicio; $('#hFin').value = h.fin;
    $('#hAlmI').value = h.almuerzoIni; $('#hAlmF').value = h.almuerzoFin;
    $('#hDur').value = h.duracion; $('#hCupos').value = h.cupos; $('#hAdel').value = h.diasAdelante;
    $('#errHorario').textContent = ''; $('#okHorario').textContent = '';
    pintarBloqueados();
  }
  function pintarBloqueados() {
    const l = [...cfg.horario.bloqueados].sort();
    $('#chipsBloq').innerHTML = l.length
      ? l.map(f => `<span class="chip">${esc(EPS.fechaLarga(f))}<button data-quitar="${f}" aria-label="Quitar">×</button></span>`).join('')
      : '<span class="nota">No hay días bloqueados.</span>';
  }
  $('#addBloq').onclick = () => {
    const f = $('#bloqFecha').value;
    if (f && !cfg.horario.bloqueados.includes(f)) { cfg.horario.bloqueados.push(f); guardar(); pintarBloqueados(); }
  };
  $('#chipsBloq').addEventListener('click', e => {
    const f = e.target.dataset.quitar; if (!f) return;
    cfg.horario.bloqueados = cfg.horario.bloqueados.filter(x => x !== f);
    guardar(); pintarBloqueados();
  });
  $('#saveHorario').onclick = () => {
    const dias = $$('#dias input:checked').map(x => Number(x.value));
    const h = {
      dias, inicio: $('#hInicio').value, fin: $('#hFin').value,
      almuerzoIni: $('#hAlmI').value, almuerzoFin: $('#hAlmF').value,
      duracion: Number($('#hDur').value), cupos: Number($('#hCupos').value), diasAdelante: Number($('#hAdel').value),
      bloqueados: cfg.horario.bloqueados
    };
    const err = $('#errHorario');
    if (!dias.length) { err.textContent = 'Elija al menos un día de atención.'; return; }
    if (!h.inicio || !h.fin || h.inicio >= h.fin) { err.textContent = 'La hora de cierre debe ser posterior a la de inicio.'; return; }
    if ((h.almuerzoIni || h.almuerzoFin) && (!h.almuerzoIni || !h.almuerzoFin || h.almuerzoIni >= h.almuerzoFin)) { err.textContent = 'Revise el horario de almuerzo (o deje ambos campos vacíos).'; return; }
    if (!(h.duracion >= 5) || !(h.cupos >= 1) || !(h.diasAdelante >= 1)) { err.textContent = 'Minutos, cupos y días de anticipación deben ser números válidos.'; return; }
    err.textContent = '';
    cfg.horario = h; guardar();
    $('#okHorario').textContent = 'Horarios guardados.';
  };

  /* =========================================================
     PREGUNTAS AL PACIENTE
     ========================================================= */
  const TIPOS = [['text', 'Texto corto'], ['textarea', 'Texto largo'], ['yesno', 'Sí / No'], ['select', 'Lista de opciones']];
  function renderPreguntas() {
    $('#listaPreguntas').innerHTML = cfg.preguntas.map((q, i) => `
      <div class="preg" data-i="${i}">
        <label class="campo ancho">Pregunta<input data-f="texto" value="${esc(q.texto)}" maxlength="200"></label>
        <label class="campo">Tipo de respuesta<select data-f="tipo">${TIPOS.map(t => `<option value="${t[0]}"${t[0] === q.tipo ? ' selected' : ''}>${t[1]}</option>`).join('')}</select></label>
        <label class="campo">Se muestra en<select data-f="servicio"><option value="all">Todos los servicios</option>${cfg.servicios.map(s => `<option value="${esc(s.id)}"${s.id === q.servicio ? ' selected' : ''}>${esc(s.nombre)}</option>`).join('')}</select></label>
        ${q.tipo === 'select' ? `<label class="campo ancho">Opciones (separadas por coma)<input data-f="opciones" value="${esc((q.opciones || []).join(', '))}"></label>` : ''}
        <label class="chk"><input type="checkbox" data-f="obligatoria"${q.obligatoria ? ' checked' : ''}> Obligatoria</label>
        <div><button class="btn peligro chico" data-del="${i}">Eliminar</button></div>
      </div>`).join('') || '<p class="nota">Aún no hay preguntas. Agregue la primera.</p>';
  }
  $('#listaPreguntas').addEventListener('change', e => {
    const f = e.target.dataset.f, fila = e.target.closest('.preg');
    if (!f || !fila) return;
    const q = cfg.preguntas[fila.dataset.i];
    if (f === 'obligatoria') q.obligatoria = e.target.checked;
    else if (f === 'opciones') q.opciones = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
    else q[f] = e.target.value;
    guardar();
    if (f === 'tipo') renderPreguntas();
  });
  $('#listaPreguntas').addEventListener('click', e => {
    const i = e.target.dataset.del; if (i == null) return;
    if (!confirm('¿Eliminar esta pregunta? Las respuestas de citas anteriores se conservan.')) return;
    cfg.preguntas.splice(i, 1); guardar(); renderPreguntas();
  });
  $('#addPregunta').onclick = () => {
    cfg.preguntas.push({ id: 'q' + Date.now(), texto: 'Nueva pregunta', tipo: 'text', opciones: [], obligatoria: false, servicio: 'all' });
    guardar(); renderPreguntas();
  };

  /* =========================================================
     QR
     ========================================================= */
  function renderQR() {
    if (!$('#qrUrl').value) $('#qrUrl').value = location.href.replace(/admin\.html.*$/, 'index.html');
    generarQR();
  }
  function generarQR() {
    const box = $('#qrBox'); box.innerHTML = '';
    const url = $('#qrUrl').value.trim();
    if (!url) return;
    new QRCode(box, { text: url, width: 260, height: 260, correctLevel: QRCode.CorrectLevel.M });
  }
  $('#genQR').onclick = generarQR;
  $('#bajarQR').onclick = () => {
    const c = $('#qrBox canvas');
    if (!c) { alert('Genere el QR primero.'); return; }
    const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = 'QR_citas_NuevaEPS.png'; a.click();
  };
  $('#imprimirQR').onclick = () => {
    const c = $('#qrBox canvas'); if (!c) { alert('Genere el QR primero.'); return; }
    const w = window.open('', '_blank');
    w.document.write(`<body style="font-family:sans-serif;text-align:center;padding:40px"><h1>Agende su cita sin hacer fila</h1><p style="font-size:20px">Nueva EPS – ${esc(cfg.sede)}</p><img src="${c.toDataURL('image/png')}" width="360"><p style="font-size:18px">Escanee el código con la cámara de su celular</p></body>`);
    w.document.close(); w.focus(); w.print();
  };

  /* =========================================================
     AJUSTES
     ========================================================= */
  function renderAjustes() {
    $('#aSede').value = cfg.sede; $('#aMensaje').value = cfg.mensaje; $('#aClave').value = '';
    $('#aEmPk').value = cfg.emailjs.publicKey; $('#aEmSv').value = cfg.emailjs.serviceId; $('#aEmTp').value = cfg.emailjs.templateId;
    $('#okAjustes').textContent = '';
  }
  $('#saveAjustes').onclick = () => {
    cfg.sede = $('#aSede').value.trim() || EPS.DEF.sede;
    cfg.mensaje = $('#aMensaje').value.trim() || EPS.DEF.mensaje;
    const k = $('#aClave').value;
    if (k) {
      if (k.length < 6) { $('#okAjustes').textContent = 'La clave debe tener al menos 6 caracteres.'; return; }
      cfg.admin.clave = k;
    }
    cfg.emailjs = { publicKey: $('#aEmPk').value.trim(), serviceId: $('#aEmSv').value.trim(), templateId: $('#aEmTp').value.trim() };
    guardar();
    $('#aClave').value = '';
    $('#okAjustes').textContent = 'Ajustes guardados.';
  };
  $('#bkExport').onclick = () => {
    const blob = new Blob([JSON.stringify({ config: EPS.getConfig(), citas: EPS.getCitas() }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `copia_citas_NuevaEPS_${EPS.hoy()}.json`; a.click(); URL.revokeObjectURL(a.href);
  };
  $('#bkImport').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (!d.config || !Array.isArray(d.citas)) throw new Error('formato');
        if (!confirm('Esto reemplaza la configuración y las citas actuales. ¿Continuar?')) return;
        EPS.saveConfig(d.config); EPS.saveCitas(d.citas);
        cfg = EPS.getConfig(); alert('Copia restaurada.'); abrirTab('agenda');
      } catch (err) { alert('El archivo no es una copia válida.'); }
    };
    r.readAsText(f); e.target.value = '';
  });
  $('#bkBorrar').onclick = () => {
    if (!confirm('¿Borrar TODAS las citas? Esta acción no se puede deshacer.')) return;
    if (prompt('Escriba BORRAR para confirmar') !== 'BORRAR') return;
    EPS.saveCitas([]); alert('Citas borradas.'); abrirTab('agenda');
  };
})();
