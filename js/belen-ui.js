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
                   ${botones.map((b, i) => `<button type="button" data-boton="${i}" ${b.id ? `id="${esc(b.id)}"` : ''} class="px-5 py-2.5 rounded-lg text-sm font-bold transition-colors ${estilos[b.estilo || (b.primario ? 'primario' : 'secundario')]}">${esc(b.texto)}</button>`).join('')}
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
        const draftKey = (function () {
            if (op.sinBorrador) return null;
            const t = String(op.titulo || '').toLowerCase();
            if (!t || /confirm|eliminar|desactivar|restablecer|acceso|aviso|fefo|asignar|cambiar área|registrar paciente|consulta directa|fusionar|receta externa|nuevo ingreso|editar insumo|editar personal|agregar personal/.test(t)) return null;
            const params = new URLSearchParams(window.location.search);
            const turno = params.get('turno') || params.get('id') || 'global';
            return 'belen_draft_modal_' + turno + '_' + t.replace(/[^a-z0-9]+/g, '_');
        })();
        const limpiarBorradorModal = () => {
            if (draftKey) { try { sessionStorage.removeItem(draftKey); } catch (e) {} }
        };
        ctrl.limpiarBorrador = limpiarBorradorModal;
        overlay.querySelectorAll('[data-boton]').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = +btn.getAttribute('data-boton');
                const def = botones[idx];
                const esAccion = def.estilo === 'primario' || def.estilo === 'exito' || def.estilo === 'alerta' || def.estilo === 'peligro' || (idx === botones.length - 1 && botones.length > 1 && def.estilo !== 'secundario');
                const fn = typeof def.alPulsar === 'function' ? def.alPulsar : (typeof def.accion === 'function' ? def.accion : null);
                const r = fn ? fn(ctrl) : undefined;
                if (r !== false) {
                    if (esAccion) limpiarBorradorModal();
                    ctrl.cerrar();
                }
            });
        });
        requestAnimationFrame(() => { overlay.classList.remove('opacity-0'); overlay.firstElementChild.classList.remove('scale-95'); });
        if (typeof op.alMostrar === 'function') op.alMostrar(ctrl);
        if (draftKey) {
            try {
                const raw = sessionStorage.getItem(draftKey);
                if (raw) {
                    const saved = JSON.parse(raw);
                    let restaurados = 0;
                    Object.keys(saved || {}).forEach(id => {
                        const el = overlay.querySelector('#' + id);
                        if (!el || el.readOnly || el.disabled || el.type === 'hidden' || el.type === 'password') return;
                        if (el.type === 'checkbox') {
                            if (el.checked !== !!saved[id]) { el.checked = !!saved[id]; el.dispatchEvent(new Event('change', { bubbles: true })); restaurados++; }
                        } else if (String(saved[id] || '').trim() !== '' && el.value !== saved[id]) {
                            el.value = saved[id];
                            el.dispatchEvent(new Event('input', { bubbles: true }));
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                            restaurados++;
                        }
                    });
                    if (restaurados > 0 && ctrl.cuerpo) {
                        const aviso = document.createElement('div');
                        aviso.className = 'mb-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold rounded-lg px-3 py-1.5 flex items-center justify-between';
                        aviso.innerHTML = '<span><i class="fas fa-floppy-disk mr-1.5"></i>Se recuperó automáticamente su borrador sin guardar.</span><button type="button" class="text-[11px] underline ml-2">Limpiar</button>';
                        aviso.querySelector('button').addEventListener('click', () => { limpiarBorradorModal(); aviso.remove(); });
                        ctrl.cuerpo.insertBefore(aviso, ctrl.cuerpo.firstChild);
                    }
                }
                const guardarDraft = () => {
                    const data = {};
                    overlay.querySelectorAll('input[id], textarea[id], select[id]').forEach(el => {
                        if (el.readOnly || el.disabled || el.type === 'hidden' || el.type === 'password') return;
                        data[el.id] = el.type === 'checkbox' ? el.checked : el.value;
                    });
                    sessionStorage.setItem(draftKey, JSON.stringify(data));
                };
                overlay.addEventListener('input', guardarDraft);
                overlay.addEventListener('change', guardarDraft);
            } catch (e) {}
        }
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
                ${campo('ta_sistolica', 'TA sistólica', 'mmHg', true, 'step="1" min="30" max="300" placeholder="Ej. 120 o 180"')}
                ${campo('ta_diastolica', 'TA diastólica', 'mmHg', true, 'step="1" min="15" max="200" placeholder="Ej. 80 o 120"')}
                ${campo('frecuencia_cardiaca', 'Frecuencia cardíaca', 'lpm', true, 'step="1" min="15" max="280"')}
                ${campo('frecuencia_respiratoria', 'Frecuencia respiratoria', 'rpm', true, 'step="1" min="2" max="90"')}
                ${campo('temperatura_c', 'Temperatura', '°C', true, 'step="0.1" min="25" max="45"')}
                ${campo('spo2_porcentaje', 'Saturación de oxígeno', '%', true, 'step="1" min="20" max="100"')}
                ${campo('peso_kg', 'Peso', 'kg', false, 'step="0.1" min="0.3" max="400"')}
                ${campo('talla_m', 'Talla', 'm', false, 'step="0.01" min="0.2" max="2.6"')}
                <div class="col-span-2">${campo('glucemia', 'Glucosa capilar / Dxtx', 'mg/dL', false, 'step="1" min="10" max="600"')}</div>
            </div>
            <div id="svm-alerta-critica" class="hidden mt-3 text-xs font-bold rounded-lg px-3 py-2 border"></div>
            <p class="mt-2 text-[11px] text-slate-500"><i class="fas fa-circle-info text-cyan-600 mr-1"></i>Se permiten valores de urgencia o crisis (ej. TA <b>180/120</b> mmHg); el sistema mostrará alerta clínica para el médico sin bloquear el registro.</p>
            <p id="svm-error-general" class="hidden mt-2 text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2"></p>`;

        return modal({
            titulo: editando ? 'Editar Signos Vitales' : 'Capturar Signos Vitales', subtitulo: 'Los campos con * son obligatorios', tipo: 'info', icono: 'fa-heart-pulse', ancho: 'md', html: html,
            alMostrar: ctrl => {
                const primero = ctrl.el.querySelector('#svm-ta_sistolica');
                if (primero) primero.setAttribute('data-autofoco', '');
                const actualizarAlertaViva = () => {
                    if (!S.alertasSignosVitales) return;
                    const actual = {};
                    Object.keys(S.RANGOS_SIGNOS).forEach(c => { const i = ctrl.el.querySelector('#svm-' + c); actual[c] = i ? i.value : ''; });
                    const al = S.alertasSignosVitales(actual);
                    const box = ctrl.el.querySelector('#svm-alerta-critica');
                    if (!box) return;
                    if (!al.alertas.length) { box.classList.add('hidden'); return; }
                    box.className = 'mt-3 text-xs font-bold rounded-lg px-3 py-2 border ' + (al.critico ? 'bg-red-50 border-red-300 text-red-800' : 'bg-amber-50 border-amber-300 text-amber-900');
                    box.innerHTML = '<i class="fas fa-triangle-exclamation mr-1"></i>' + (al.critico ? 'Signos en rango crítico (se guardarán con alerta para el médico): ' : 'Signos fuera de rango habitual: ') + al.alertas.map(x => esc(x.texto)).join(' · ');
                };
                ctrl.el.querySelectorAll('input').forEach(inp => inp.addEventListener('input', actualizarAlertaViva));
                actualizarAlertaViva();
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
        const ind = exp.indicaciones || {};
        const vit = (sv.ta_sistolica ? `TA ${sv.ta_sistolica}/${sv.ta_diastolica}` : '') + (sv.frecuencia_cardiaca ? ` · FC ${sv.frecuencia_cardiaca}` : '') +
                    (sv.frecuencia_respiratoria ? ` · FR ${sv.frecuencia_respiratoria}` : '') + (sv.temperatura_c ? ` · Temp ${sv.temperatura_c}` : '') + (sv.spo2_porcentaje ? ` · SpO2 ${sv.spo2_porcentaje}%` : '') + (sv.glucemia ? ` · Dxtx ${sv.glucemia} mg/dL` : '');
        const ef = textoExploracionVisita(exp);
        return bloque('Motivo de consulta', c.motivo_consulta) + bloque('Padecimiento actual', c.padecimiento_actual) + bloque('Signos vitales', vit) +
               bloque('Exploración física', ef) +
               bloque('Estudios auxiliares', c.estudios_auxiliares) + bloque('Diagnósticos', dx) + bloque('Análisis clínico', c.analisis_clinico) +
               bloque('Plan de tratamiento', c.plan_tratamiento) + bloque('Pronóstico', c.pronostico) +
               bloque('Alergias', a.alergias && a.alergias.presente ? a.alergias.descripcion : '') +
               bloque('Indicaciones: dieta', (ind.dieta || {}).texto) + bloque('Indicaciones: medicamentos', (ind.medicamentos || {}).texto);
    }

    function textoExploracionVisita(exp) {
        const lista = (exp && exp.exploracion_fisica) || [];
        const libre = lista.find(x => x && (x.sistema_codigo === 'libre' || x.estatus === 'LIBRE'));
        if (libre && libre.hallazgo) return libre.hallazgo + (libre.fcf_lpm ? '\nFrecuencia cardíaca fetal: ' + libre.fcf_lpm + ' lpm' : '');
        if ((exp.consulta || {}).exploracion_libre) return exp.consulta.exploracion_libre;
        return lista.map(x => {
            if (!x) return '';
            const hallazgo = x.estatus === 'ALTERADO' ? (x.hallazgo || 'Alteración sin descripción') : (x.hallazgo || 'Sin hallazgos descritos');
            return (x.sistema || 'Sistema') + ': ' + hallazgo;
        }).filter(Boolean).join('\n');
    }

    function htmlDocumentoClinico(pieza) {
        const bloque = (titulo, valor) => valor ? `<div class="mb-3"><p class="text-[10px] font-bold text-slate-400 uppercase mb-0.5">${esc(titulo)}</p><p class="text-sm text-slate-700 whitespace-pre-line">${esc(valor)}</p></div>` : '';
        if (!pieza) return '';
        if (pieza.tipo === 'consulta') return resumenVisitaHTML(pieza.visita || {});
        if (pieza.tipo === 'historia') {
            const exp = pieza.visita || {};
            const a = (exp.antecedentes || {}).heredofamiliares || {};
            const app = ((exp.antecedentes || {}).personales_patologicos || {});
            return bloque('Antecedentes heredofamiliares', a.negado ? 'Interrogados y negados.' : a.detalle) +
                bloque('Antecedentes patológicos', app.negado_todo ? 'Interrogados y negados.' : (app.otras_enfermedades || '')) +
                resumenVisitaHTML(exp);
        }
        const n = pieza.nota || {};
        if (pieza.tipo === 'evolucion') {
            const sv = (n.objetivo && n.objetivo.signos_vitales) || {};
            const vit = [sv.ta_sistolica ? 'TA ' + sv.ta_sistolica + '/' + (sv.ta_diastolica || '') : '', sv.frecuencia_cardiaca ? 'FC ' + sv.frecuencia_cardiaca : ''].filter(Boolean).join(' · ');
            return bloque('Subjetivo', n.subjetivo || n.evolucion) + bloque('Exploración física', (n.objetivo && n.objetivo.exploracion_fisica) || n.exploracion_fisica) +
                bloque('Signos vitales', vit) + bloque('Análisis', n.analisis) + bloque('Plan', n.plan) + bloque('Diagnóstico', n.diagnostico_actualizado || n.diagnostico_vigente);
        }
        if (pieza.tipo === 'postoperatoria') {
            return bloque('Diagnóstico preoperatorio', n.dx_pre) + bloque('Operación', n.operacion) + bloque('Diagnóstico postoperatorio', n.dx_post) +
                bloque('Técnica', n.tecnica) + bloque('Hallazgos', n.hallazgos) + bloque('Pronóstico', n.pronostico);
        }
        if (pieza.tipo === 'postanestesica') {
            return bloque('Técnica anestésica', n.tecnica_texto || n.tecnica) + bloque('Evolución', n.evolucion) + bloque('Incidentes', n.incidentes);
        }
        if (pieza.tipo === 'egreso') {
            return bloque('Motivo de egreso', n.motivo_egreso) + bloque('Resumen clínico', n.resumen_clinico) + bloque('Diagnóstico final', n.diagnostico_final) +
                bloque('Pronóstico', n.pronostico) + bloque('Plan de alta', n.plan_alta);
        }
        return bloque(pieza.titulo, '');
    }

    function abrirMisCedulas(alActualizar) {
        const S = global.BelenStore;
        const s = S && S.sesion();
        const u = s && S.USUARIOS[s.usuario_id];
        if (!u || u.rol !== 'medico') { toast('Solo el médico puede configurar sus cédulas y título impreso.', 'alerta'); return null; }
        const tituloActual = (S.especialidadImpresaMedico && S.especialidadImpresaMedico(u)) || u.titulo_impreso || u.cargo || 'Medicina General';
        const univActual = u.universidad_titulo || '';
        const sugerenciasTitulo = [
            'Medicina General',
            'Médico Cirujano y Partero',
            'Cirugía General y Laparoscópica',
            'Ginecología y Obstetricia',
            'Traumatología y Ortopedia',
            'Angiología y Cirugía Vascular',
            'Medicina Interna',
            'Pediatría Médica',
            'Anestesiología',
            'Urología'
        ];
        const filasCedulas = S.CEDULAS_FIRMA.map(c => {
            const valActual = u[c.campo] || '';
            const on = valActual ? (u.cedulas_visibles || []).indexOf(c.codigo) >= 0 : (c.codigo === 'general');
            const etForm = c.etiquetaFormulario || c.etiqueta;
            return `<div class="rounded-xl border border-slate-200 bg-white p-3 space-y-1.5">
                <div class="flex items-center justify-between gap-2">
                    <label class="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" data-vis="${esc(c.codigo)}" class="rounded text-cyan-600" ${on ? 'checked' : ''}>
                        <span class="text-xs font-extrabold text-slate-800 uppercase">${esc(etForm)}</span>
                    </label>
                    <span class="text-[11px] font-semibold text-cyan-700 bg-cyan-50 border border-cyan-200 rounded px-2 py-0.5">Se imprime como: "${esc(c.etiqueta)}: …"</span>
                </div>
                <input type="text" data-campo-ced="${esc(c.campo)}" data-cod-ced="${esc(c.codigo)}" value="${esc(valActual)}" placeholder="Número de cédula (opcional si no aplica)" class="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-slate-800">
            </div>`;
        }).join('');
        const chipsHtml = sugerenciasTitulo.map(t => `<button type="button" data-sug-titulo="${esc(t)}" class="text-[11px] font-semibold px-2 py-1 rounded-full border border-slate-200 bg-slate-50 hover:bg-cyan-50 hover:border-cyan-300 hover:text-cyan-900 transition">${esc(t)}</button>`).join('');
        return modal({
            titulo: 'Mis Cédulas y Especialidad Impresa',
            subtitulo: 'Personalice cómo aparecen su especialidad/título y sus cédulas en todas las recetas, notas e indicaciones.',
            icono: 'fa-id-card',
            ancho: 'lg',
            html: `<div class="space-y-4 text-left">
                <div class="rounded-xl border border-cyan-200 bg-cyan-50/60 p-3">
                    <label for="ced-titulo-impreso" class="block text-[11px] font-extrabold text-cyan-950 uppercase mb-1">Título / Especialidad impresa debajo de su nombre <span class="text-red-500">*</span></label>
                    <input id="ced-titulo-impreso" type="text" value="${esc(tituloActual)}" placeholder="Ej. Cirugía General y Laparoscópica, Traumatología y Ortopedia, Médico Cirujano y Partero..." class="w-full border border-cyan-300 rounded-lg px-3 py-2 text-sm font-bold text-slate-900 bg-white">
                    <p class="text-[11px] text-slate-500 mt-1.5 mb-1">Opciones rápidas (o escriba libremente la suya):</p>
                    <div class="flex flex-wrap gap-1.5">${chipsHtml}</div>
                    <div class="mt-2.5">
                        <label for="ced-universidad" class="block text-[11px] font-bold text-slate-600 uppercase mb-1">Universidad / Institución que avala (opcional)</label>
                        <input id="ced-universidad" type="text" value="${esc(univActual)}" placeholder="Ej. Universidad de Guadalajara (UdeG) / UNAM" class="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-800 bg-white">
                    </div>
                </div>
                <div class="space-y-2">
                    <p class="text-xs font-extrabold text-slate-700 uppercase">Cédulas registradas y casillas para imprimir</p>
                    ${filasCedulas}
                </div>
                <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
                    <p class="text-[10px] font-bold uppercase text-slate-400 mb-1">Vista previa en encabezado y firma de Receta / Nota</p>
                    <p class="text-sm font-extrabold text-slate-900">${esc(u.nombre)}</p>
                    <p id="ced-preview-titulo" class="text-xs font-bold text-cyan-900">${esc(tituloActual)}</p>
                    <p id="ced-preview-lineas" class="text-[11px] text-slate-700 whitespace-pre-line mt-0.5"></p>
                </div>
                <p id="ced-error" class="text-xs text-red-600 hidden text-left font-semibold"></p>
            </div>`,
            alMostrar: c => {
                const inpTitulo = c.el.querySelector('#ced-titulo-impreso');
                const inpUniv = c.el.querySelector('#ced-universidad');
                const prevTit = c.el.querySelector('#ced-preview-titulo');
                const prevLin = c.el.querySelector('#ced-preview-lineas');
                const actualizarPreview = () => {
                    const tit = (inpTitulo.value || '').trim() || 'Medicina General';
                    const uni = (inpUniv.value || '').trim();
                    prevTit.textContent = tit + (uni ? ' · ' + uni : '');
                    const lineas = [];
                    S.CEDULAS_FIRMA.forEach(cf => {
                        const chk = c.el.querySelector('[data-vis="' + cf.codigo + '"]');
                        const inp = c.el.querySelector('[data-campo-ced="' + cf.campo + '"]');
                        const val = inp ? inp.value.trim() : '';
                        if (chk && chk.checked && val) lineas.push(cf.etiqueta + ': ' + val);
                    });
                    prevLin.textContent = lineas.length ? lineas.join(' · ') : 'Seleccione al menos una cédula con número';
                };
                c.el.querySelectorAll('[data-sug-titulo]').forEach(b => b.addEventListener('click', () => {
                    inpTitulo.value = b.getAttribute('data-sug-titulo');
                    actualizarPreview();
                }));
                c.el.querySelectorAll('[data-campo-ced]').forEach(inp => inp.addEventListener('input', () => {
                    const cod = inp.getAttribute('data-cod-ced');
                    const chk = c.el.querySelector('[data-vis="' + cod + '"]');
                    if (chk && inp.value.trim()) chk.checked = true;
                    actualizarPreview();
                }));
                c.el.querySelectorAll('input').forEach(i => i.addEventListener('input', actualizarPreview));
                c.el.querySelectorAll('input[type="checkbox"]').forEach(i => i.addEventListener('change', actualizarPreview));
                actualizarPreview();
            },
            botones: [
                { texto: 'Cancelar', estilo: 'secundario' },
                { texto: 'Guardar configuración', estilo: 'primario', alPulsar: c => {
                    const vis = Array.from(c.el.querySelectorAll('[data-vis]:checked')).map(x => x.getAttribute('data-vis'));
                    const datosExtra = {
                        titulo_impreso: c.el.querySelector('#ced-titulo-impreso').value,
                        universidad_titulo: c.el.querySelector('#ced-universidad').value
                    };
                    c.el.querySelectorAll('[data-campo-ced]').forEach(inp => {
                        datosExtra[inp.getAttribute('data-campo-ced')] = inp.value;
                    });
                    const r = S.guardarCedulasVisibles(u.id, vis, S.sesion(), datosExtra);
                    const error = c.el.querySelector('#ced-error');
                    if (!r.ok) { error.textContent = r.motivo; error.classList.remove('hidden'); return false; }
                    toast('Especialidad impresa y cédulas actualizadas.', 'exito');
                    if (typeof alActualizar === 'function') alActualizar();
                } }
            ]
        });
    }

    // op: { pacienteId, excluirTurnoId, renderDocumento(pieza)->html, titulo }
    function modalHistorial(op) {
        const S = global.BelenStore;
        const pac = S.buscarPacientePorId(op.pacienteId);
        if (!pac) { toast('No se encontró el paciente.', 'alerta'); return null; }
        const piezas = S.piezasClinicasPaciente(op.pacienteId, op.excluirTurnoId);
        if (!piezas.length) { toast('Este paciente no tiene notas clínicas anteriores.', 'info'); return null; }
        const lista = piezas.map((p, i) => {
            const f = String(p.fecha || '').slice(0, 16).replace('T', ' ');
            return `<button type="button" data-doc="${i}" class="w-full text-left rounded-lg border border-slate-200 px-3 py-2 hover:border-cyan-400 transition">
                <span class="block text-sm font-bold text-slate-800">${esc(p.titulo)}</span>
                <span class="block text-[11px] text-slate-500">${esc(S.fechaHoraLegible ? S.fechaHoraLegible(p.fecha) : f)}${p.medico ? ' · ' + esc(p.medico) : ''}</span></button>`;
        }).join('');
        const html = `<div class="grid grid-cols-1 md:grid-cols-[16rem_1fr] gap-4 text-left" id="historial-visitas">
            <div class="flex flex-col gap-2 md:max-h-[60vh] overflow-y-auto" id="historial-lista">${lista}</div>
            <div id="historial-detalle" class="border border-slate-200 rounded-xl p-4 bg-slate-50/50 md:max-h-[60vh] overflow-y-auto"></div></div>`;
        return modal({
            titulo: op.titulo || 'Historial de Visitas Anteriores', subtitulo: `${pac.nombre_completo} · ${piezas.length} documento${piezas.length === 1 ? '' : 's'} clínico${piezas.length === 1 ? '' : 's'} · orden cronológico · solo lectura`, icono: 'fa-clock-rotate-left', ancho: 'xxl', html: html,
            alMostrar: ctrl => {
                const mostrar = i => {
                    ctrl.el.querySelectorAll('[data-doc]').forEach(b => {
                        const act = +b.getAttribute('data-doc') === i;
                        b.classList.toggle('border-cyan-500', act); b.classList.toggle('bg-cyan-50', act);
                    });
                    let h = '';
                    try {
                        h = (op.renderDocumento && op.renderDocumento(piezas[i])) || htmlDocumentoClinico(piezas[i]);
                    } catch (e) { h = htmlDocumentoClinico(piezas[i]); }
                    ctrl.el.querySelector('#historial-detalle').innerHTML = h || '<p class="text-sm text-slate-500">Esta nota no tiene texto clínico.</p>';
                };
                ctrl.el.querySelectorAll('[data-doc]').forEach(b => b.addEventListener('click', () => mostrar(+b.getAttribute('data-doc'))));
                mostrar(piezas.length - 1);
            },
            botones: [{ texto: 'Cerrar', estilo: 'secundario' }]
        });
    }

    function abrirTerminalEstudios(op) {
        const S = global.BelenStore;
        if (!S) { toast('No se encontró el catálogo de estudios.', 'peligro'); return null; }
        const s = S.sesion();
        const turnoId = op && op.turnoId;
        const t = turnoId && S.obtenerTurno(turnoId);
        if (!s || !S.permisoAccionDe(s.usuario_id, 'cargar_consumos')) { toast('Su perfil no puede cargar estudios.', 'alerta'); return null; }
        if (!t || !S.episodioAbiertoParaEstudios(t)) { toast('Este paciente no tiene un episodio activo para cargar estudios.', 'alerta'); return null; }
        const estudios = S.listarEstudios();
        if (!estudios.length) { toast('El catálogo de estudios está vacío.', 'alerta'); return null; }
        const admin = S.puedeAlterarMontoEstudio(s);
        const enfermeria = S.esEnfermeria(s.rol);
        const ocultarPrecios = enfermeria || (s && s.rol === 'medico');
        const bloques = [
            { id: 'lab', titulo: '🧪 Laboratorios y Tubos', cats: ['LABORATORIO'] },
            { id: 'pat', titulo: '🧫 Biopsias / Patología', cats: ['PATOLOGIA'] },
            { id: 'img', titulo: '🩻 Rayos X e Imagen', cats: ['IMAGENOLOGIA'] },
            { id: 'proc', titulo: '🩺 Procedimientos de Enfermería', cats: ['PROCEDIMIENTO'] },
            { id: 'hosp', titulo: '🏨 Estancia y hospitalización', cats: ['HOSPITALIZACION'] }
        ];
        const chip = est => {
            const tubo = est.tubo_muestra && est.tubo_muestra !== 'N/A' ? est.tubo_muestra : '';
            const emoji = tubo ? S.resumenTubosEstudios([est.estudio_id]).texto.split(' ')[0] : '';
            const precio = ocultarPrecios ? '' : (admin
                ? `<input data-precio="${esc(est.estudio_id)}" type="number" min="0.01" step="0.01" value="${est.precio_unitario}" class="mt-1 w-28 border border-slate-300 rounded-lg px-2 py-1 text-xs">`
                : `<input data-precio="${esc(est.estudio_id)}" type="text" readonly disabled value="${esc(S.formatoMoneda(est.precio_unitario))}" class="mt-1 w-28 border border-slate-200 rounded-lg px-2 py-1 text-xs bg-slate-100 text-slate-600">`);
            const q = S.normalizar([est.codigo, est.nombre, S.nombreTipoEstudio(est.categoria), tubo].join(' '));
            return `<label data-est-item data-q="${esc(q)}" class="flex items-start gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 cursor-pointer hover:border-cyan-400">
                <input type="checkbox" data-est="${esc(est.estudio_id)}" data-nombre="${esc(est.nombre)}" class="mt-1 rounded border-slate-300 text-cyan-700">
                <span class="min-w-0 flex-1">
                    <span class="block text-sm font-extrabold text-slate-900">${esc(est.nombre)}</span>
                    <span class="block text-[11px] font-bold text-slate-500">${esc(S.nombreTipoEstudio(est.categoria))}</span>
                    ${tubo ? `<span class="block text-[11px] font-bold text-violet-800">${emoji ? esc(emoji) + ' ' : ''}${esc(tubo)}</span>` : '<span class="block text-[11px] text-slate-400">Sin tubo</span>'}
                    ${precio}
                </span>
            </label>`;
        };
        const paneles = bloques.map((b, i) => {
            const items = estudios.filter(est => b.cats.indexOf(est.categoria) >= 0);
            return `<div data-bloque="${b.id}" class="${i === 0 ? '' : 'hidden'} grid grid-cols-1 sm:grid-cols-2 gap-2">${items.length ? items.map(chip).join('') : '<p class="text-sm text-slate-400">No hay conceptos en este bloque.</p>'}</div>`;
        }).join('');
        const tabs = bloques.map((b, i) => `<button type="button" data-tab="${b.id}" class="px-3 py-2 rounded-lg text-xs font-extrabold ${i === 0 ? 'bg-white text-cyan-800 shadow-sm' : 'text-slate-500'}">${esc(b.titulo)}</button>`).join('');
        return modal({
            titulo: '🧪 Cargar Estudios / Tubos / Procedimientos',
            subtitulo: t.paciente_nombre || '',
            icono: 'fa-vial',
            ancho: 'xxl',
            html: `<div class="space-y-3 text-left">
                <div id="seleccion-estudios" class="sticky top-0 z-10 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 flex flex-wrap gap-2 min-h-[2.5rem] items-center"><span class="text-xs text-slate-400">Ningún estudio seleccionado.</span></div>
                <input id="busca-estudio-modal" type="search" placeholder="Buscar estudio, código o tubo" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" autocomplete="off">
                <div id="tubos-resumen" class="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm font-bold text-violet-950">Tubos requeridos/tomados para esta orden: ninguno todavía.</div>
                <div class="inline-flex flex-wrap gap-1 bg-slate-100 rounded-xl p-1">${tabs}</div>
                ${paneles}
                <label class="block text-[11px] font-bold text-slate-500 uppercase">Observaciones de toma / Laboratorio externo al que se envía</label>
                <textarea id="toma-obs" maxlength="240" rows="2" placeholder="Opcional. Ej. Se envía a Laboratorio Patología del Puerto." class="w-full border border-slate-300 rounded-lg p-2.5 text-sm"></textarea>
                <p class="text-[11px] text-slate-500">${ocultarPrecios ? 'Usted ve el estudio, la categoría y el tubo. Los importes los registra Caja.' : (admin ? 'Dirección puede corregir un monto en esta orden. El catálogo no cambia.' : 'Precio oficial bloqueado. Caja y el resto del personal no pueden modificarlo.')}</p>
                <p id="toma-error" class="text-xs text-red-600 hidden"></p>
            </div>`,
            alMostrar: c => {
                let tabActiva = bloques[0].id;
                const pintarTubos = () => {
                    const ids = Array.from(c.el.querySelectorAll('[data-est]:checked')).map(x => x.getAttribute('data-est'));
                    const r = S.resumenTubosEstudios(ids);
                    const nodoTubos = c.el.querySelector('#tubos-resumen');
                    if (r.tubos && r.tubos.length) {
                        nodoTubos.innerHTML = '<div class="flex flex-wrap items-center gap-2"><span class="text-xs font-extrabold uppercase text-violet-900">Muestras físicas a recolectar (1 tubo por color):</span>' +
                            r.tubos.map(tb => `<span class="inline-flex items-center gap-1.5 rounded-lg bg-white border border-violet-300 px-2.5 py-1 text-xs font-extrabold text-violet-950 shadow-sm">${esc(tb.emoji || '🧪')} ${tb.cantidad}x ${esc(tb.tubo)} <span class="font-semibold text-slate-600">→ ${esc((tb.estudios || []).join(', '))}</span></span>`).join('') +
                            '</div>';
                    } else {
                        nodoTubos.textContent = ids.length ? 'Tubos requeridos/tomados para esta orden: ninguno. Los conceptos marcados no piden tubo.' : 'Tubos requeridos/tomados para esta orden: ninguno todavía.';
                    }
                    const caja = c.el.querySelector('#seleccion-estudios');
                    const marcados = Array.from(c.el.querySelectorAll('[data-est]:checked'));
                    if (!marcados.length) { caja.innerHTML = '<span class="text-xs font-bold text-slate-500">Seleccionados para Cargar: ninguno.</span>'; return; }
                    caja.innerHTML = '<span class="text-[11px] font-extrabold uppercase text-cyan-900 mr-1">Seleccionados para Cargar</span>' + marcados.map(chk => {
                        const id = chk.getAttribute('data-est');
                        return `<button type="button" data-quitar="${esc(id)}" class="inline-flex items-center gap-1 bg-cyan-700 text-white text-xs font-bold rounded-full px-2.5 py-1">${esc(chk.getAttribute('data-nombre'))} <span aria-hidden="true">✕</span></button>`;
                    }).join('');
                    caja.querySelectorAll('[data-quitar]').forEach(b => b.addEventListener('click', () => {
                        const chk = c.el.querySelector('[data-est="' + b.getAttribute('data-quitar') + '"]');
                        if (chk) { chk.checked = false; pintarTubos(); }
                    }));
                };
                const mostrarTab = id => {
                    tabActiva = id;
                    c.el.querySelectorAll('[data-tab]').forEach(b => {
                        const on = b.getAttribute('data-tab') === id;
                        b.classList.toggle('bg-white', on); b.classList.toggle('text-cyan-800', on); b.classList.toggle('shadow-sm', on); b.classList.toggle('text-slate-500', !on);
                    });
                };
                const filtrar = () => {
                    const q = S.normalizar(c.el.querySelector('#busca-estudio-modal').value);
                    c.el.querySelectorAll('[data-est-item]').forEach(el => {
                        el.classList.toggle('hidden', !!q && el.getAttribute('data-q').indexOf(q) < 0);
                    });
                    c.el.querySelectorAll('[data-bloque]').forEach(p => {
                        if (q) {
                            const alguno = Array.from(p.querySelectorAll('[data-est-item]')).some(el => !el.classList.contains('hidden'));
                            p.classList.toggle('hidden', !alguno);
                        } else {
                            p.classList.toggle('hidden', p.getAttribute('data-bloque') !== tabActiva);
                        }
                    });
                };
                c.el.querySelectorAll('[data-tab]').forEach(btn => btn.addEventListener('click', () => {
                    c.el.querySelector('#busca-estudio-modal').value = '';
                    mostrarTab(btn.getAttribute('data-tab'));
                    filtrar();
                }));
                c.el.querySelector('#busca-estudio-modal').addEventListener('input', filtrar);
                c.el.querySelectorAll('[data-est]').forEach(chk => chk.addEventListener('change', pintarTubos));
                pintarTubos();
            },
            botones: [
                { texto: 'Cancelar', estilo: 'secundario' },
                { texto: 'Confirmar y Cargar', estilo: 'primario', alPulsar: c => {
                    const ids = Array.from(c.el.querySelectorAll('[data-est]:checked')).map(x => x.getAttribute('data-est'));
                    const precios = {};
                    if (admin) ids.forEach(id => { const inp = c.el.querySelector('[data-precio="' + id + '"]'); if (inp) precios[id] = inp.value; });
                    const r = S.cargarEstudiosACuenta(turnoId, { estudio_ids: ids, precios: admin ? precios : null, observaciones: c.el.querySelector('#toma-obs').value }, s);
                    const error = c.el.querySelector('#toma-error');
                    if (!r.ok) { error.textContent = r.motivo; error.classList.remove('hidden'); return false; }
                    const n = r.cargos.length;
                    toast(ocultarPrecios
                        ? (n + (n === 1 ? ' estudio cargado a la cuenta.' : ' estudios cargados a la cuenta.'))
                        : (n + (n === 1 ? ' estudio cargado' : ' estudios cargados') + ' · ' + S.formatoMoneda(r.total) + ' en la cuenta.'), 'exito');
                    if (op && typeof op.alGuardar === 'function') op.alGuardar(r);
                } }
            ]
        });
    }

    function htmlIdentidadPaciente(op) {
        op = op || {};
        const p = op.prefijo || 'id';
        const cls = op.cls || 'w-full border border-slate-300 rounded-lg p-2.5 text-sm text-slate-800 outline-none bg-white';
        const v = op.valores || {};
        const bloquear = !!op.bloquear;
        const ro = bloquear ? 'readonly' : '';
        const dis = bloquear ? 'disabled' : '';
        const bg = bloquear ? 'bg-slate-50' : '';
        const lab = (id, texto, obligatorio) => `<label for="${p}-${id}" class="block text-[11px] font-bold text-slate-500 uppercase mb-1">${texto}${obligatorio === false ? '' : ' <span class="text-red-500">*</span>'}</label>`;
        const err = k => `<p data-err="${k}" class="text-[11px] text-red-600 mt-1 hidden"></p>`;
        const hoy = (global.BelenStore && global.BelenStore.hoyLocal) ? global.BelenStore.hoyLocal() : '';
        const span = op.span || 'sm:col-span-2';
        const nacActual = v.nacionalidad || 'Mexicana';
        const edadInicial = (v.fecha_nacimiento && global.BelenStore && global.BelenStore.formatearEdad) ? global.BelenStore.formatearEdad(v.fecha_nacimiento) : '';
        return `
            <div class="${span}">${lab('nombres', 'Nombre(s)')}<input id="${p}-nombres" type="text" autocomplete="off" value="${esc(v.nombres || '')}" ${ro} placeholder="Ej. Juan Carlos" class="${cls} ${bg}" ${op.autofoco && !bloquear ? 'data-autofoco' : ''}>${err('nombres')}</div>
            <div class="${span}">${lab('paterno', 'Apellido paterno')}<input id="${p}-paterno" type="text" autocomplete="off" value="${esc(v.apellido_paterno || '')}" ${ro} placeholder="Ej. Pérez" class="${cls} ${bg}">${err('paterno')}</div>
            <div class="${span}">${lab('materno', 'Apellido materno', false)}<input id="${p}-materno" type="text" autocomplete="off" value="${esc(v.apellido_materno || '')}" ${ro} placeholder="Ej. Gómez" class="${cls} ${bg}">${err('materno')}</div>
            ${op.sugerencias ? `<div class="sm:col-span-6" id="${p}-sugerencias"></div>` : ''}
            <div class="${span}">
                <div class="flex items-center justify-between mb-1">
                    <label for="${p}-fn" class="block text-[11px] font-bold text-slate-500 uppercase">Fecha de nacimiento <span class="text-red-500">*</span></label>
                    <span id="${p}-edad-badge" class="${edadInicial ? '' : 'hidden '}text-[11px] font-extrabold px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-900">${esc(edadInicial)}</span>
                </div>
                <input id="${p}-fn" type="date" min="1900-01-01" max="${esc(hoy)}" value="${esc(v.fecha_nacimiento || '')}" ${ro} class="${cls} ${bg}" onchange="(function(el){var S=window.BelenStore,b=document.getElementById('${p}-edad-badge');if(!b||!S||!S.formatearEdad)return;var txt=el.value?S.formatearEdad(el.value):'';b.textContent=txt;b.classList.toggle('hidden',!txt);})(this)">
                ${err('fn')}
            </div>
            <div class="${span}">${lab('sexo', 'Sexo')}<select id="${p}-sexo" class="${cls} ${bg}" ${dis}><option value="">Seleccione…</option><option value="F" ${v.sexo === 'F' ? 'selected' : ''}>Femenino</option><option value="M" ${v.sexo === 'M' ? 'selected' : ''}>Masculino</option></select>${err('sexo')}</div>
            <div class="${span}">${lab('tel', 'Teléfono / Celular')}<input id="${p}-tel" type="tel" inputmode="tel" maxlength="20" autocomplete="off" value="${esc(v.telefono || '')}" placeholder="10 dígitos" class="${cls}">${err('tel')}</div>
            <div class="sm:col-span-2">${lab('nac', 'Nacionalidad', false)}<input id="${p}-nac" type="text" list="${p}-lista-nac" maxlength="60" autocomplete="off" value="${esc(nacActual)}" placeholder="Mexicana / Extranjera (país)" class="${cls}">
                <datalist id="${p}-lista-nac"><option value="Mexicana"></option><option value="Estadounidense (EE. UU.)"></option><option value="Canadiense"></option><option value="Colombiana"></option><option value="Argentina"></option><option value="Española"></option><option value="Otra extranjera"></option></datalist>
            </div>
            <div class="sm:col-span-4">${lab('dir', 'Dirección / Domicilio')}<input id="${p}-dir" type="text" maxlength="150" autocomplete="off" value="${esc(v.direccion || '')}" placeholder="Calle, número, colonia y ciudad" class="${cls}">${err('dir')}</div>`;
    }
    function leerIdentidadPaciente(raiz, prefijo) {
        const S = global.BelenStore;
        const q = id => { const n = raiz.querySelector('#' + prefijo + '-' + id); return n ? n.value : ''; };
        const nombres = S.limpiarEspacios(q('nombres'));
        const paterno = S.limpiarEspacios(q('paterno'));
        const materno = S.limpiarEspacios(q('materno'));
        return {
            nombres: nombres, apellido_paterno: paterno, apellido_materno: materno,
            nombre_completo: S.limpiarEspacios([nombres, paterno, materno].filter(Boolean).join(' ')),
            fecha_nacimiento: q('fn'), sexo: q('sexo'),
            nacionalidad: S.limpiarEspacios(q('nac')) || 'Mexicana',
            telefono: String(q('tel') || '').replace(/\D/g, ''),
            direccion: S.limpiarEspacios(q('dir'))
        };
    }

    // Modal para verificar identidad y revisar expediente existente antes de seleccionarlo en Recepción
    function modalVerificarExpediente(pacienteId, alConfirmarUso) {
        const S = global.BelenStore;
        const p = S && S.buscarPacientePorId(pacienteId);
        if (!p) { toast('No se encontró el expediente solicitado.', 'alerta'); return null; }
        const edadTxt = S.formatearEdad ? S.formatearEdad(p.fecha_nacimiento) : (S.calcularEdad(p.fecha_nacimiento) + ' años');
        const visitas = S.visitasDePaciente ? S.visitasDePaciente(p.paciente_id) : [];
        const piezas = S.piezasClinicasPaciente ? S.piezasClinicasPaciente(p.paciente_id) : [];
        const ant = S.antecedentesLongitudinales ? S.antecedentesLongitudinales(p.paciente_id) : null;
        const alergias = (ant && ant.personales_patologicos && ant.personales_patologicos.alergias && ant.personales_patologicos.alergias.presente)
            ? ant.personales_patologicos.alergias.descripcion
            : 'NEGADAS / Sin alergias registradas';
        const tieneAlergia = alergias.indexOf('NEGADAS') < 0;
        const htmlVisitas = visitas.length
            ? visitas.slice(-5).reverse().map(v => {
                const f = (v.consulta && v.consulta.fecha_hora) ? (S.fechaHoraLegible ? S.fechaHoraLegible(v.consulta.fecha_hora) : String(v.consulta.fecha_hora).slice(0, 10)) : 'Sin fecha';
                const med = (v.consulta && v.consulta.medico_tratante) || (v.meta && v.meta.medico_nombre) || 'Médico';
                const mot = (v.consulta && v.consulta.motivo_consulta) || 'Sin motivo registrado';
                const dx = (v.diagnosticos || []).map(d => (d.cie10_codigo ? d.cie10_codigo + ' ' : '') + d.descripcion).join(', ') || 'Sin diagnóstico';
                return `<div class="rounded-lg border border-slate-200 bg-white p-2.5 text-xs">
                    <div class="flex items-center justify-between font-bold text-slate-800"><span>${esc(f)}</span><span class="text-cyan-800">${esc(med)}</span></div>
                    <p class="text-slate-600 mt-1"><b>Motivo:</b> ${esc(mot)}</p>
                    <p class="text-slate-700 mt-0.5"><b>Dx:</b> ${esc(dx)}</p>
                </div>`;
            }).join('')
            : '<p class="text-xs text-slate-500 italic">Aún no tiene consultas previas cerradas en el sistema.</p>';

        return modal({
            titulo: 'Verificación de Identidad y Expediente Existente',
            subtitulo: 'Confirme fecha de nacimiento, teléfono y dirección con el paciente antes de usar este expediente.',
            icono: 'fa-id-card-clip',
            ancho: 'lg',
            html: `<div class="space-y-3 text-left">
                <div class="rounded-xl border-2 border-cyan-500 bg-cyan-50/70 p-4">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <span class="inline-block text-[11px] font-extrabold uppercase bg-cyan-700 text-white px-2.5 py-0.5 rounded-full">Expediente ${esc(p.paciente_id)}</span>
                            <h4 class="text-lg font-extrabold text-slate-900 mt-1">${esc(p.nombre_completo)}</h4>
                        </div>
                        <span class="text-sm font-extrabold text-cyan-900 bg-white border border-cyan-200 px-3 py-1 rounded-lg">${esc(edadTxt)} · ${p.sexo === 'F' ? 'Femenino' : (p.sexo === 'M' ? 'Masculino' : 'Sexo no reg.')}</span>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-3 text-xs bg-white rounded-lg p-3 border border-cyan-100">
                        <div><span class="text-slate-400 font-bold uppercase block text-[10px]">Fecha de Nacimiento</span><b class="text-slate-800 text-sm">${esc(S.fechaLegibleISO ? S.fechaLegibleISO(p.fecha_nacimiento) : p.fecha_nacimiento)} (${esc(edadTxt)})</b></div>
                        <div><span class="text-slate-400 font-bold uppercase block text-[10px]">Teléfono / Celular</span><b class="text-slate-800 text-sm">${esc(p.telefono || 'No registrado')}</b></div>
                        <div><span class="text-slate-400 font-bold uppercase block text-[10px]">Dirección / Domicilio</span><b class="text-slate-800">${esc(p.direccion || 'No registrada')}</b></div>
                        <div><span class="text-slate-400 font-bold uppercase block text-[10px]">Nacionalidad / Estado Civil</span><b class="text-slate-800">${esc(p.nacionalidad || 'Mexicana')}${p.estado_civil ? ' · ' + esc(p.estado_civil) : ''}${p.ocupacion ? ' · ' + esc(p.ocupacion) : ''}</b></div>
                    </div>
                    <div class="mt-2.5 rounded-lg px-3 py-2 text-xs font-bold ${tieneAlergia ? 'bg-red-100 text-red-900 border border-red-300' : 'bg-emerald-50 text-emerald-900 border border-emerald-200'}">
                        <i class="fas ${tieneAlergia ? 'fa-triangle-exclamation' : 'fa-shield-heart'} mr-1"></i>Alergias en expediente: ${esc(alergias)}
                    </div>
                </div>
                <div>
                    <div class="flex items-center justify-between mb-1.5">
                        <p class="text-xs font-extrabold uppercase text-slate-600">Historial de atenciones previas (${visitas.length} consulta${visitas.length === 1 ? '' : 's'} · ${piezas.length} documento${piezas.length === 1 ? '' : 's'})</p>
                        ${piezas.length ? `<button type="button" id="btn-ver-notas-modal" class="text-xs font-bold text-cyan-700 hover:underline"><i class="fas fa-book-medical mr-1"></i>Abrir notas clínicas completas</button>` : ''}
                    </div>
                    <div class="space-y-2 max-h-48 overflow-y-auto">${htmlVisitas}</div>
                </div>
            </div>`,
            alMostrar: c => {
                const btnNotas = c.el.querySelector('#btn-ver-notas-modal');
                if (btnNotas) btnNotas.addEventListener('click', () => modalHistorial({ pacienteId: p.paciente_id }));
            },
            botones: [
                { texto: 'No es la misma persona (Cerrar)', estilo: 'secundario' },
                ...(typeof alConfirmarUso === 'function' ? [{
                    texto: '✅ Sí es esta persona · Usar este expediente',
                    estilo: 'exito',
                    alPulsar: () => { alConfirmarUso(p); }
                }] : [])
            ]
        });
    }

    // ============================================================
    // MODAL GLOBAL: CACHÉ DE AVANCES, DOCUMENTOS Y 4 ESCENARIOS SINCRONIZADOS
    // ============================================================
    function vistaPreviaDocumentoCache(docId) {
        const S = global.BelenStore;
        if (!S || !S.obtenerDocumentosCacheRecorrido) return;
        const docs = S.obtenerDocumentosCacheRecorrido();
        const doc = docs.find(d => d.id === docId);
        if (!doc) {
            toast('No se encontró el documento solicitado.', 'alerta');
            return;
        }
        return modal({
            titulo: doc.titulo,
            subtitulo: doc.escenario + ' · ' + (doc.norma || 'NOM-004-SSA3-2012'),
            icono: 'fa-file-medical',
            ancho: 'xl',
            sinBorrador: true,
            html: '<div class="bg-slate-100 p-4 rounded-xl border border-slate-300 overflow-x-auto"><div id="contenedor-impresion-cache-doc" class="bg-white p-6 rounded shadow-sm mx-auto" style="max-width:20.5cm;">' + (doc.html || '') + '</div></div>',
            botones: [
                { texto: 'Cerrar', estilo: 'secundario' },
                {
                    texto: '🖨️ Imprimir / Guardar PDF',
                    estilo: 'primario',
                    alPulsar: () => {
                        const w = window.open('', '_blank', 'width=920,height=780');
                        if (!w) {
                            window.print();
                            return false;
                        }
                        w.document.write('<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>' + esc(doc.titulo) + '</title><style>@page{size:letter;margin:1.2cm;}body{margin:0;padding:12px;font-family:Arial,sans-serif;color:#0f172a;}</style></head><body>' + (doc.html || '') + '<script>setTimeout(function(){window.print();},350);<\/script></body></html>');
                        w.document.close();
                        return false;
                    }
                }
            ]
        });
    }

    function abrirCacheAvancesYDocumentos(tabInicial) {
        const S = global.BelenStore;
        if (!S) return;
        if (S.asegurarCasosClinicosRecorrido) S.asegurarCasosClinicosRecorrido(false);
        const bitacora = S.BITACORA_CACHE_AVANCES || [];
        const docs = S.obtenerDocumentosCacheRecorrido ? S.obtenerDocumentosCacheRecorrido() : [];
        const catalogoOficial = S.CATALOGO_FORMATOS_OFICIALES || [];
        const idsCache = (S.obtenerIdsCacheRecorrido && S.obtenerIdsCacheRecorrido()) || {};
        const turno1Id = idsCache.t1 || 'T-CACHE-1';
        const turno2Id = idsCache.t2 || 'T-CACHE-2';
        const turno3Id = idsCache.t3 || 'T-CACHE-3';
        const turno4Id = idsCache.t4 || 'T-CACHE-4';

        const htmlTabAvances = bitacora.map((b, i) => (
            '<div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">' +
                '<div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5 mb-2.5">' +
                    '<div class="flex items-center gap-2">' +
                        '<span class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-cyan-700 text-white text-xs font-extrabold">' + (i + 1) + '</span>' +
                        '<h4 class="text-sm font-extrabold text-slate-900">' + esc(b.bloque) + '</h4>' +
                    '</div>' +
                    '<span class="text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 px-2.5 py-0.5 rounded-full">Paciente Demo: ' + esc(b.paciente_demo) + '</span>' +
                '</div>' +
                '<ul class="space-y-1.5 text-xs text-slate-700 list-disc pl-5">' +
                    (b.puntos || []).map(p => '<li>' + esc(p) + '</li>').join('') +
                '</ul>' +
            '</div>'
        )).join('');

        const htmlTabDocs =
            '<div class="space-y-3">' +
                '<div class="rounded-xl bg-cyan-50 border border-cyan-200 p-3 text-xs text-cyan-950 flex flex-wrap items-center justify-between gap-2">' +
                    '<div><b>Documentos reales generados en los 4 escenarios clínicos:</b> Haz clic en <b>Vista Previa / Imprimir</b> para ver cada formato lleno con datos reales (listos en cualquier computadora).</div>' +
                '</div>' +
                '<div class="grid grid-cols-1 md:grid-cols-2 gap-3">' +
                    docs.map(d => (
                        '<div class="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm flex flex-col justify-between gap-2.5 hover:border-cyan-400 transition">' +
                            '<div>' +
                                '<div class="flex items-center justify-between gap-2">' +
                                    '<span class="text-[10px] font-extrabold uppercase tracking-wider text-cyan-800 bg-cyan-50 border border-cyan-200 px-2 py-0.5 rounded">' + esc(d.norma || 'NOM-004') + '</span>' +
                                    '<span class="text-[10px] font-bold text-slate-400">Turno ' + esc(d.turno_id) + '</span>' +
                                '</div>' +
                                '<h5 class="text-xs font-extrabold text-slate-900 mt-1.5">' + esc(d.titulo) + '</h5>' +
                                '<p class="text-[11px] text-slate-500 mt-0.5">' + esc(d.escenario) + '</p>' +
                            '</div>' +
                            '<div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">' +
                                '<button type="button" data-ver-doc="' + esc(d.id) + '" class="text-xs font-bold bg-cyan-700 hover:bg-cyan-600 text-white px-3 py-1.5 rounded-lg transition flex items-center gap-1.5">' +
                                    '<i class="fas fa-eye"></i> Vista Previa / Imprimir' +
                                '</button>' +
                            '</div>' +
                        '</div>'
                    )).join('') +
                '</div>' +
                '<div class="mt-4 pt-3 border-t border-slate-200">' +
                    '<h5 class="text-xs font-extrabold uppercase text-slate-600 mb-2">Catálogo de los ' + catalogoOficial.length + ' Machotes Oficiales de Google Drive (Sanatorio Belén)</h5>' +
                    '<div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">' +
                        catalogoOficial.map(f => (
                            '<div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px]">' +
                                '<div class="font-extrabold text-slate-800">' + esc(f.numero) + '. ' + esc(f.nombre) + '</div>' +
                                '<div class="text-slate-500 text-[10px]">' + esc(f.area) + ' · ' + esc(f.norma) + '</div>' +
                            '</div>'
                        )).join('') +
                    '</div>' +
                '</div>' +
            '</div>';

        const htmlTabPacientes =
            '<div class="grid grid-cols-1 md:grid-cols-2 gap-3">' +
                '<div class="rounded-xl border-2 border-emerald-200 bg-white p-4 shadow-sm">' +
                    '<span class="text-[10px] font-extrabold uppercase bg-emerald-100 text-emerald-900 px-2.5 py-0.5 rounded-full">Escenario 1 · Consulta + 2 Meds en 1 Jeringa + Pre-cobro</span>' +
                    '<h4 class="text-sm font-extrabold text-slate-900 mt-1.5">Carlos Alberto Mendoza Ruiz</h4>' +
                    '<p class="text-xs text-slate-600 mt-1">Turno <b>T-CACHE-1</b> · Dr. Juan Pérez · Orden de aplicación en clínica (Ketorolaco 30 mg + Dexametasona 8 mg en 1 sola jeringa cargada por Enfermería) · Cuenta cobrada anticipadamente y cerrada a histórico sin doble cobro.</p>' +
                    '<div class="mt-3 flex flex-wrap gap-2">' +
                        '<a href="expediente.html?turno=" + encodeURIComponent(turno1Id) + "&modo=visor" class="text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5"><i class="fas fa-folder-open"></i> Abrir Expediente</a>' +
                    '</div>' +
                '</div>' +
                '<div class="rounded-xl border-2 border-cyan-300 bg-white p-4 shadow-sm">' +
                    '<span class="text-[10px] font-extrabold uppercase bg-cyan-100 text-cyan-900 px-2.5 py-0.5 rounded-full">Escenario 2 · Hospitalización 5 Días + TAC + Qx con Alfonso</span>' +
                    '<h4 class="text-sm font-extrabold text-slate-900 mt-1.5">María Elena Gómez Valdez (Cama HOSP-3)</h4>' +
                    '<p class="text-xs text-slate-600 mt-1">Turno <b>T-CACHE-2</b> · Observación sin papelería Qx -> Interconsulta Med. Interna -> TAC de Cráneo y Labs confirmados por Enfermería -> Cirugía por Angiología confirmada por Alfonso -> Hoja Quirúrgica con equipo pre-llenado y Pre-Alta.</p>' +
                    '<div class="mt-3 flex flex-wrap gap-2">' +
                        '<a href="expediente.html?turno=" + encodeURIComponent(turno2Id) + "&modo=visor" class="text-xs font-bold bg-cyan-700 hover:bg-cyan-600 text-white px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5"><i class="fas fa-bed-pulse"></i> Abrir Portafolio Hospitalario (HOSP-3)</a>' +
                    '</div>' +
                '</div>' +
                '<div class="rounded-xl border-2 border-rose-200 bg-white p-4 shadow-sm">' +
                    '<span class="text-[10px] font-extrabold uppercase bg-rose-100 text-rose-900 px-2.5 py-0.5 rounded-full">Escenario 3 · Embarazada Directo a Parto (Sin Consulta)</span>' +
                    '<h4 class="text-sm font-extrabold text-slate-900 mt-1.5">Valeria Sofía Hernández Luna (Cama REC-GINECO)</h4>' +
                    '<p class="text-xs text-slate-600 mt-1">Turno <b>' + esc(turno3Id) + '</b> · Ingreso directo con Dra. Patricia Solís -> Nota de Ingreso e Historia Clínica Directa -> Nota de Parto y Alumbramiento (NOM-007) -> Hoja de Recién Nacido (Dr. Carlos Méndez).</p>' +
                    '<div class="mt-3 flex flex-wrap gap-2">' +
                        '<a href="expediente.html?turno=' + encodeURIComponent(turno3Id) + '&modo=visor" class="text-xs font-bold bg-rose-700 hover:bg-rose-600 text-white px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5"><i class="fas fa-baby"></i> Abrir Portafolio Obstétrico y RN</a>' +
                    '</div>' +
                '</div>' +
                '<div class="rounded-xl border-2 border-amber-300 bg-white p-4 shadow-sm">' +
                    '<span class="text-[10px] font-extrabold uppercase bg-amber-100 text-amber-900 px-2.5 py-0.5 rounded-full">Escenario 4 · Alta Voluntaria desde Observación (NOM-004)</span>' +
                    '<h4 class="text-sm font-extrabold text-slate-900 mt-1.5">Jorge Luis Navarro Pineda (Observación OBS-2)</h4>' +
                    '<p class="text-xs text-slate-600 mt-1">Turno <b>T-CACHE-4</b> · Egreso voluntario con responsiva médico-legal (NOM-004 numeral 10.2 y Art. 79 RLGSPSAM), 2 testigos, exoneración total al Sanatorio y sin cargo de habitación de hospitalización.</p>' +
                    '<div class="mt-3 flex flex-wrap gap-2">' +
                        '<a href="expediente.html?turno=" + encodeURIComponent(turno4Id) + "&modo=visor" class="text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5"><i class="fas fa-file-signature"></i> Abrir Expediente / Carta Alta Voluntaria</a>' +
                    '</div>' +
                '</div>' +
            '</div>';

        return modal({
            titulo: 'Caché Sincronizado de Avances, Documentos y Casos Clínicos',
            subtitulo: 'Disponible en todas tus computadoras · Incluye la bitácora de mejoras, los formatos oficiales llenos y los 4 pacientes del recorrido.',
            icono: 'fa-cloud-arrow-down',
            ancho: 'xxl',
            sinBorrador: true,
            html:
                '<div class="space-y-4 text-left">' +
                    '<div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">' +
                        '<div class="flex flex-wrap gap-1.5">' +
                            '<button type="button" data-tab-cache="avances" class="px-3.5 py-2 rounded-lg text-xs font-extrabold bg-cyan-700 text-white transition"><i class="fas fa-list-check mr-1"></i>1. Caché de lo Realizado y Corregido</button>' +
                            '<button type="button" data-tab-cache="documentos" class="px-3.5 py-2 rounded-lg text-xs font-extrabold bg-slate-100 text-slate-700 hover:bg-slate-200 transition"><i class="fas fa-file-medical mr-1"></i>2. Documentos y Formatos Llenos (' + docs.length + ')</button>' +
                            '<button type="button" data-tab-cache="pacientes" class="px-3.5 py-2 rounded-lg text-xs font-extrabold bg-slate-100 text-slate-700 hover:bg-slate-200 transition"><i class="fas fa-user-injured mr-1"></i>3. Abrir los 4 Casos en Vivo</button>' +
                        '</div>' +
                        '<button type="button" id="btn-resincronizar-cache" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-300 hover:bg-emerald-100 transition flex items-center gap-1.5">' +
                            '<i class="fas fa-rotate"></i> Restaurar / Sincronizar Casos en esta Compu' +
                        '</button>' +
                    '</div>' +
                    '<div id="panel-cache-avances" class="space-y-3">' + htmlTabAvances + '</div>' +
                    '<div id="panel-cache-documentos" class="hidden">' + htmlTabDocs + '</div>' +
                    '<div id="panel-cache-pacientes" class="hidden">' + htmlTabPacientes + '</div>' +
                '</div>',
            alMostrar: ctrl => {
                const activarTab = (nombre) => {
                    ['avances', 'documentos', 'pacientes'].forEach(t => {
                        const p = ctrl.el.querySelector('#panel-cache-' + t);
                        const b = ctrl.el.querySelector('[data-tab-cache="' + t + '"]');
                        if (p) p.classList.toggle('hidden', t !== nombre);
                        if (b) {
                            b.className = t === nombre
                                ? 'px-3.5 py-2 rounded-lg text-xs font-extrabold bg-cyan-700 text-white transition'
                                : 'px-3.5 py-2 rounded-lg text-xs font-extrabold bg-slate-100 text-slate-700 hover:bg-slate-200 transition';
                        }
                    });
                };
                ctrl.el.querySelectorAll('[data-tab-cache]').forEach(btn => {
                    btn.addEventListener('click', () => activarTab(btn.getAttribute('data-tab-cache')));
                });
                ctrl.el.querySelectorAll('[data-ver-doc]').forEach(btn => {
                    btn.addEventListener('click', () => vistaPreviaDocumentoCache(btn.getAttribute('data-ver-doc')));
                });
                const btnResync = ctrl.el.querySelector('#btn-resincronizar-cache');
                if (btnResync) {
                    btnResync.addEventListener('click', () => {
                        if (S.asegurarCasosClinicosRecorrido) {
                            S.asegurarCasosClinicosRecorrido(true);
                            toast('Los 4 escenarios clínicos y todos sus documentos se han sincronizado en esta computadora.', 'exito');
                            ctrl.cerrar();
                            setTimeout(() => window.location.reload(), 350);
                        }
                    });
                }
                if (tabInicial) activarTab(tabInicial);
            },
            botones: [
                { texto: 'Cerrar ventana', estilo: 'secundario' }
            ]
        });
    }

    global.BelenUI = { esc, toast, modal, confirmar, aviso, modalSignosVitales, modalHistorial, modalVerificarExpediente, resumenVisitaHTML, abrirMisCedulas, abrirTerminalEstudios, htmlIdentidadPaciente, leerIdentidadPaciente, abrirCacheAvancesYDocumentos, vistaPreviaDocumentoCache, TIPOS };
})(window);
