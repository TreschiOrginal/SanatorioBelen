// Archivo: js/belen-ui.js
// ============================================================
// INTERFAZ COMPARTIDA: toasts y modales Tailwind (CERO alert/prompt/confirm nativos)
// Requiere Tailwind CDN y (para el modal de signos vitales) js/belen-store.js
// ============================================================
(function (global) {
    'use strict';

    const pila = [];   // modales abiertos (el último es el que recibe Escape)

    function esc(t) {
        return String(t === null || t === undefined ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    const TIPOS = {
        info:    { icono: 'fa-circle-info',          fondo: 'bg-cyan-100',    texto: 'text-cyan-600',    boton: 'bg-cyan-600 hover:bg-cyan-500' },
        exito:   { icono: 'fa-circle-check',         fondo: 'bg-emerald-100', texto: 'text-emerald-600', boton: 'bg-emerald-600 hover:bg-emerald-500' },
        alerta:  { icono: 'fa-triangle-exclamation', fondo: 'bg-amber-100',   texto: 'text-amber-600',   boton: 'bg-amber-500 hover:bg-amber-400' },
        peligro: { icono: 'fa-circle-exclamation',   fondo: 'bg-red-100',     texto: 'text-red-600',     boton: 'bg-red-600 hover:bg-red-500' }
    };

    // ------------------------------------------------------------ Toasts
    function contenedorToasts() {
        let c = document.getElementById('contenedor-toasts');
        if (!c) {
            c = document.createElement('div');
            c.id = 'contenedor-toasts';
            c.className = 'fixed top-4 right-4 z-[200] flex flex-col gap-2 w-80 max-w-[90vw] print:hidden';
            document.body.appendChild(c);
        }
        return c;
    }
    function toast(mensaje, tipo, ms) {
        const t = TIPOS[tipo] || TIPOS.info;
        const n = document.createElement('div');
        n.className = 'bg-white border border-slate-200 shadow-lg rounded-xl p-3 flex items-start gap-3 transition-all duration-300 opacity-0 translate-x-4';
        n.setAttribute('role', 'status');
        n.innerHTML = `<div class="w-8 h-8 rounded-full ${t.fondo} ${t.texto} flex items-center justify-center shrink-0"><i class="fas ${t.icono} text-sm"></i></div>
                       <p class="text-sm text-slate-700 leading-snug pt-1">${esc(mensaje)}</p>`;
        contenedorToasts().appendChild(n);
        requestAnimationFrame(() => { n.classList.remove('opacity-0', 'translate-x-4'); });
        setTimeout(() => { n.classList.add('opacity-0', 'translate-x-4'); setTimeout(() => n.remove(), 300); }, ms || 3800);
    }

    // ------------------------------------------------------------ Modal base
    // op: { titulo, subtitulo, mensaje, html, tipo, ancho:'sm|md|lg|xl', centrado, cerrable, botones:[{texto, estilo:'primario|secundario|peligro|alerta', alPulsar(ctrl) -> false para no cerrar, id}], alMostrar(ctrl), alCerrar() }
    function modal(op) {
        op = op || {};
        const t = TIPOS[op.tipo] || TIPOS.info;
        const anchos = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl', xxl: 'max-w-6xl' };
        const cerrable = op.cerrable !== false;
        const centrado = !!op.centrado;

        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 transition-opacity duration-200 opacity-0 print:hidden';
        overlay.style.zIndex = String(100 + pila.length * 2);
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');

        const cabecera = centrado
            ? `<div class="text-center px-6 pt-6">
                   <div class="w-14 h-14 rounded-full ${t.fondo} ${t.texto} flex items-center justify-center mx-auto mb-3"><i class="fas ${op.icono || t.icono} text-2xl"></i></div>
                   <h3 class="text-lg font-bold text-slate-800">${esc(op.titulo || '')}</h3>
                   ${op.subtitulo ? `<p class="text-xs text-slate-500 mt-1">${esc(op.subtitulo)}</p>` : ''}
               </div>`
            : `<div class="flex items-start justify-between gap-3 px-6 pt-5 pb-3 border-b border-slate-100">
                   <div class="flex items-center gap-3 min-w-0">
                       <div class="w-10 h-10 rounded-full ${t.fondo} ${t.texto} flex items-center justify-center shrink-0"><i class="fas ${op.icono || t.icono}"></i></div>
                       <div class="min-w-0"><h3 class="text-base font-bold text-slate-800 leading-tight">${esc(op.titulo || '')}</h3>
                       ${op.subtitulo ? `<p class="text-xs text-slate-500">${esc(op.subtitulo)}</p>` : ''}</div>
                   </div>
                   ${cerrable ? '<button type="button" data-cerrar aria-label="Cerrar" class="text-slate-400 hover:text-slate-700 w-8 h-8 rounded-full hover:bg-slate-100 shrink-0"><i class="fas fa-xmark"></i></button>' : ''}
               </div>`;

        const cuerpo = `<div data-cuerpo class="px-6 py-4 ${centrado ? 'text-center' : ''} text-sm text-slate-600 overflow-y-auto" style="max-height:70vh">
                            ${op.mensaje ? `<p class="leading-relaxed">${esc(op.mensaje)}</p>` : ''}${op.html || ''}</div>`;

        const botones = (op.botones || []);
        const estilos = {
            primario: 'bg-cyan-600 hover:bg-cyan-500 text-white',
            exito: 'bg-emerald-600 hover:bg-emerald-500 text-white',
            peligro: 'bg-red-600 hover:bg-red-500 text-white',
            alerta: 'bg-amber-500 hover:bg-amber-400 text-white',
            secundario: 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-50'
        };
        const pie = botones.length
            ? `<div class="px-6 pb-5 pt-2 flex flex-col-reverse sm:flex-row gap-2 ${centrado ? 'sm:justify-center' : 'sm:justify-end'}">
                   ${botones.map((b, i) => `<button type="button" data-boton="${i}" ${b.id ? `id="${esc(b.id)}"` : ''} class="px-5 py-2.5 rounded-lg text-sm font-bold transition-colors ${estilos[b.estilo || 'secundario']}">${esc(b.texto)}</button>`).join('')}
               </div>` : '';

        overlay.innerHTML = `<div class="bg-white rounded-2xl shadow-2xl w-full ${anchos[op.ancho || 'md']} flex flex-col max-h-[92vh] transition-transform duration-200 scale-95" data-caja>${cabecera}${cuerpo}${pie}</div>`;
        document.body.appendChild(overlay);

        const ctrl = {
            el: overlay,
            cuerpo: overlay.querySelector('[data-cuerpo]'),
            cerrado: false,
            cerrar() {
                if (ctrl.cerrado) return;
                ctrl.cerrado = true;
                const i = pila.indexOf(ctrl);
                if (i >= 0) pila.splice(i, 1);
                overlay.classList.add('opacity-0');
                setTimeout(() => overlay.remove(), 180);
                if (typeof op.alCerrar === 'function') op.alCerrar();
            },
            cerrable: cerrable
        };
        pila.push(ctrl);

        overlay.querySelectorAll('[data-cerrar]').forEach(b => b.addEventListener('click', () => ctrl.cerrar()));
        overlay.addEventListener('mousedown', e => { if (e.target === overlay && cerrable) ctrl.cerrar(); });
        overlay.querySelectorAll('[data-boton]').forEach(btn => {
            btn.addEventListener('click', () => {
                const def = botones[+btn.getAttribute('data-boton')];
                const r = typeof def.alPulsar === 'function' ? def.alPulsar(ctrl) : undefined;
                if (r !== false) ctrl.cerrar();
            });
        });
        requestAnimationFrame(() => { overlay.classList.remove('opacity-0'); overlay.firstElementChild.classList.remove('scale-95'); });
        if (typeof op.alMostrar === 'function') op.alMostrar(ctrl);
        const foco = overlay.querySelector('[data-autofoco]') || overlay.querySelector('[data-boton]:last-child');
        if (foco) setTimeout(() => foco.focus(), 60);
        return ctrl;
    }

    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape' || !pila.length) return;
        const top = pila[pila.length - 1];
        if (top.cerrable) top.cerrar();
    });

    // Confirmación (reemplaza confirm()). op: { titulo, mensaje, html, tipo, textoConfirmar, textoCancelar, alConfirmar, alCancelar }
    function confirmar(op) {
        const peligro = op.tipo === 'peligro';
        return modal({
            titulo: op.titulo, mensaje: op.mensaje, html: op.html, tipo: op.tipo || 'info', icono: op.icono, centrado: true, ancho: op.ancho || 'sm', cerrable: true,
            botones: [
                { texto: op.textoCancelar || 'Cancelar', estilo: 'secundario', alPulsar: () => { if (op.alCancelar) op.alCancelar(); } },
                { texto: op.textoConfirmar || 'Confirmar', estilo: peligro ? 'peligro' : (op.tipo === 'alerta' ? 'alerta' : 'primario'), id: op.idConfirmar, alPulsar: ctrl => op.alConfirmar ? op.alConfirmar(ctrl) : undefined }
            ]
        });
    }
    // Aviso con un solo botón (reemplaza alert())
    function aviso(titulo, mensaje, tipo, alCerrar, textoBoton) {
        return modal({ titulo: titulo, mensaje: mensaje, tipo: tipo || 'info', centrado: true, ancho: 'sm', alCerrar: alCerrar,
                       botones: [{ texto: textoBoton || 'Entendido', estilo: 'primario' }] });
    }

    // ------------------------------------------------------------ Modal de Signos Vitales (reutilizable)
    // opciones: { turnoId, extra:{peso_kg,talla_m}, alGuardar(turno) }
    function modalSignosVitales(opciones) {
        const S = global.BelenStore;
        const turno = S.obtenerTurno(opciones.turnoId);
        if (!turno) { toast('No se encontró el turno del paciente.', 'peligro'); return null; }
        const sv = Object.assign({}, turno.signos_vitales || {});
        if (opciones.extra) {
            // En el expediente, los campos Peso/Talla del panel lateral son la fuente de verdad
            if (opciones.extra.peso_kg) sv.peso_kg = opciones.extra.peso_kg;
            if (opciones.extra.talla_m) sv.talla_m = opciones.extra.talla_m;
        }
        const val = c => (sv[c] === null || sv[c] === undefined) ? '' : sv[c];
        const campo = (id, etiqueta, unidad, obligatorio, extraAttr) => `
            <div>
                <label for="svm-${id}" class="block text-[11px] font-bold text-slate-500 uppercase mb-1">${esc(etiqueta)} ${obligatorio ? '<span class="text-red-500">*</span>' : '<span class="text-slate-400 normal-case font-normal">(opcional)</span>'}</label>
                <div class="relative">
                    <input type="number" inputmode="decimal" id="svm-${id}" value="${esc(val(id))}" ${extraAttr || ''} class="w-full border border-slate-300 rounded-lg p-2.5 pr-12 text-sm font-semibold text-slate-800 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none">
                    <span class="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">${esc(unidad)}</span>
                </div>
                <p id="svm-err-${id}" class="text-[11px] text-red-600 mt-1 hidden"></p>
            </div>`;
        const editando = !!turno.signos_vitales;
        const html = `
            <div class="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-4 text-xs text-slate-600">
                <b class="text-slate-800">${esc(turno.paciente_nombre)}</b> · ${esc(turno.especialidad)} #${turno.numero_turno}
                ${editando && turno.signos_vitales.capturado_por ? `<br><span class="text-slate-400">Última captura: ${esc(turno.signos_vitales.capturado_por)}</span>` : ''}
            </div>
            <div class="grid grid-cols-2 gap-3">
                ${campo('ta_sistolica', 'TA sistólica', 'mmHg', true, 'step="1" min="50" max="260"')}
                ${campo('ta_diastolica', 'TA diastólica', 'mmHg', true, 'step="1" min="30" max="160"')}
                ${campo('frecuencia_cardiaca', 'Frecuencia cardíaca', 'lpm', true, 'step="1" min="20" max="250"')}
                ${campo('frecuencia_respiratoria', 'Frecuencia respiratoria', 'rpm', true, 'step="1" min="4" max="80"')}
                ${campo('temperatura_c', 'Temperatura', '°C', true, 'step="0.1" min="30" max="45"')}
                ${campo('spo2_porcentaje', 'Saturación de oxígeno', '%', true, 'step="1" min="50" max="100"')}
                ${campo('peso_kg', 'Peso', 'kg', false, 'step="0.1" min="0.3" max="400"')}
                ${campo('talla_m', 'Talla', 'm', false, 'step="0.01" min="0.3" max="2.6"')}
            </div>
            <p id="svm-error-general" class="hidden mt-3 text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2"></p>`;

        return modal({
            titulo: editando ? 'Editar Signos Vitales' : 'Capturar Signos Vitales', subtitulo: 'Los campos con * son obligatorios', tipo: 'info', icono: 'fa-heart-pulse', ancho: 'md', html: html,
            alMostrar: ctrl => {
                const primero = ctrl.el.querySelector('#svm-ta_sistolica');
                if (primero) primero.setAttribute('data-autofoco', '');
                ctrl.el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ctrl.el.querySelector('#svm-guardar').click(); } });
            },
            botones: [
                { texto: 'Cancelar', estilo: 'secundario' },
                { texto: 'Guardar Signos Vitales', estilo: 'primario', id: 'svm-guardar', alPulsar: ctrl => {
                    const entrada = {};
                    Object.keys(S.RANGOS_SIGNOS).forEach(c => { const i = ctrl.el.querySelector('#svm-' + c); entrada[c] = i ? i.value : ''; });
                    const r = S.validarSignos(entrada);
                    Object.keys(S.RANGOS_SIGNOS).forEach(c => {
                        const i = ctrl.el.querySelector('#svm-' + c), m = ctrl.el.querySelector('#svm-err-' + c);
                        if (!i || !m) return;
                        i.classList.toggle('border-red-500', !!r.errores[c]);
                        i.classList.toggle('border-slate-300', !r.errores[c]);
                        m.classList.toggle('hidden', !r.errores[c]);
                        m.textContent = r.errores[c] || '';
                    });
                    const g = ctrl.el.querySelector('#svm-error-general');
                    if (!r.ok) {
                        g.textContent = 'Revise los campos marcados en rojo. Tensión arterial, frecuencia cardíaca, frecuencia respiratoria, temperatura y saturación son obligatorias.';
                        g.classList.remove('hidden');
                        const primeroMal = Object.keys(r.errores)[0];
                        const f = ctrl.el.querySelector('#svm-' + primeroMal); if (f) f.focus();
                        return false;
                    }
                    const actualizado = S.guardarSignos(turno.turno_id, r.valores, S.sesion());
                    toast('Signos vitales guardados.', 'exito');
                    if (typeof opciones.alGuardar === 'function') opciones.alGuardar(actualizado);
                } }
            ]
        });
    }

    // ------------------------------------------------------------ Historial de visitas (solo lectura)
    const DESTINOS = { Alta: 'Alta', Observacion: 'Observación', Hospitalizacion: 'Hospitalización' };

    // Resumen por defecto de una visita (el expediente puede pasar su propio renderVisita con la Historia Clínica completa)
    function resumenVisitaHTML(exp) {
        const c = exp.consulta || {}, p = exp.paciente || {}, a = (exp.antecedentes || {}).personales_patologicos || {};
        const sv = p.signos_vitales || {};
        const bloque = (titulo, valor) => valor ? `<div class="mb-3"><p class="text-[10px] font-bold text-slate-400 uppercase mb-0.5">${esc(titulo)}</p><p class="text-sm text-slate-700 whitespace-pre-line">${esc(valor)}</p></div>` : '';
        const dx = (exp.diagnosticos || []).map(d => `${d.cie10_codigo ? d.cie10_codigo + ' · ' : ''}${d.descripcion}`).join('\n');
        const proc = ((exp.consentimientos || {}).procedimientos || []).map(x => x.procedimiento).filter(Boolean).join('\n');
        const ind = exp.indicaciones || {};
        const vit = (sv.ta_sistolica ? `TA ${sv.ta_sistolica}/${sv.ta_diastolica}` : '') + (sv.frecuencia_cardiaca ? ` · FC ${sv.frecuencia_cardiaca}` : '') +
                    (sv.frecuencia_respiratoria ? ` · FR ${sv.frecuencia_respiratoria}` : '') + (sv.temperatura_c ? ` · Temp ${sv.temperatura_c}` : '') + (sv.spo2_porcentaje ? ` · SpO2 ${sv.spo2_porcentaje}%` : '');
        return bloque('Motivo de consulta', c.motivo_consulta) + bloque('Padecimiento actual', c.padecimiento_actual) + bloque('Signos vitales', vit) +
               bloque('Estudios auxiliares', c.estudios_auxiliares) + bloque('Diagnósticos', dx) + bloque('Análisis clínico', c.analisis_clinico) +
               bloque('Plan de tratamiento', c.plan_tratamiento) + bloque('Procedimientos con consentimiento', proc) +
               bloque('Alergias', a.alergias && a.alergias.presente ? a.alergias.descripcion : '') +
               bloque('Indicaciones: dieta', (ind.dieta || {}).texto) + bloque('Indicaciones: medicamentos', (ind.medicamentos || {}).texto);
    }

    // op: { pacienteId, excluirTurnoId, renderVisita(exp)->html, titulo }
    function modalHistorial(op) {
        const S = global.BelenStore;
        const pac = S.buscarPacientePorId(op.pacienteId);
        const visitas = S.visitasDePaciente(op.pacienteId).filter(v => !op.excluirTurnoId || (v.meta || {}).turno_id !== op.excluirTurnoId);
        if (!pac) { toast('No se encontró el paciente.', 'alerta'); return null; }
        if (!visitas.length) { toast('Este paciente no tiene visitas anteriores registradas.', 'info'); return null; }
        const render = op.renderVisita || resumenVisitaHTML;
        const lista = visitas.map((v, i) => {
            const f = ((v.consulta || {}).fecha_hora || '').slice(0, 10);
            return `<button type="button" data-visita="${i}" class="w-full text-left rounded-lg border border-slate-200 px-3 py-2 hover:border-cyan-400 transition">
                <span class="block text-sm font-bold text-slate-800">${esc(S.fechaLegibleISO(f) || 'Sin fecha')}</span>
                <span class="block text-[11px] text-slate-500">${esc((v.meta || {}).medico_nombre || (v.consulta || {}).medico_tratante || '')}</span>
                <span class="inline-block mt-1 text-[10px] font-bold uppercase bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">${esc(DESTINOS[(v.consulta || {}).destino] || (v.consulta || {}).destino || 'Consulta')}</span></button>`;
        }).join('');
        const html = `<div class="grid grid-cols-1 md:grid-cols-[14rem_1fr] gap-4 text-left" id="historial-visitas">
            <div class="flex flex-col gap-2 md:max-h-[60vh] overflow-y-auto" id="historial-lista">${lista}</div>
            <div id="historial-detalle" class="border border-slate-200 rounded-xl p-4 bg-slate-50/50 md:max-h-[60vh] overflow-y-auto"></div></div>`;
        return modal({
            titulo: op.titulo || 'Historial de Visitas Anteriores', subtitulo: `${pac.nombre_completo} · ${pac.paciente_id} · Solo lectura`, icono: 'fa-clock-rotate-left', ancho: 'xxl', html: html,
            alMostrar: ctrl => {
                const mostrar = i => {
                    ctrl.el.querySelectorAll('[data-visita]').forEach(b => {
                        const act = +b.getAttribute('data-visita') === i;
                        b.classList.toggle('border-cyan-500', act); b.classList.toggle('bg-cyan-50', act);
                    });
                    let h = '';
                    try { h = render(visitas[i]); } catch (e) { h = resumenVisitaHTML(visitas[i]); }
                    ctrl.el.querySelector('#historial-detalle').innerHTML = h;
                };
                ctrl.el.querySelectorAll('[data-visita]').forEach(b => b.addEventListener('click', () => mostrar(+b.getAttribute('data-visita'))));
                mostrar(0);
            },
            botones: [{ texto: 'Cerrar', estilo: 'secundario' }]
        });
    }

    global.BelenUI = { esc, toast, modal, confirmar, aviso, modalSignosVitales, modalHistorial, resumenVisitaHTML, TIPOS };
})(window);
