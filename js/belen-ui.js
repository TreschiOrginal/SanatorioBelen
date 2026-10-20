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
        const ind = exp.indicaciones || {};
        const vit = (sv.ta_sistolica ? `TA ${sv.ta_sistolica}/${sv.ta_diastolica}` : '') + (sv.frecuencia_cardiaca ? ` · FC ${sv.frecuencia_cardiaca}` : '') +
                    (sv.frecuencia_respiratoria ? ` · FR ${sv.frecuencia_respiratoria}` : '') + (sv.temperatura_c ? ` · Temp ${sv.temperatura_c}` : '') + (sv.spo2_porcentaje ? ` · SpO2 ${sv.spo2_porcentaje}%` : '');
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

    function abrirMisCedulas() {
        const S = global.BelenStore;
        const s = S && S.sesion();
        const u = s && S.USUARIOS[s.usuario_id];
        if (!u || u.rol !== 'medico') { toast('Solo el médico puede configurar sus cédulas de firma.', 'alerta'); return null; }
        if (S.esMedicoGeneral(u)) {
            const valor = u.cedula_general || u.cedula_profesional || 'No registrada';
            return modal({
                titulo: 'Mis Cédulas de Firma', subtitulo: u.nombre, icono: 'fa-id-card', ancho: 'md',
                html: `<p class="text-sm text-slate-600 text-left">Como médico general, sus notas, indicaciones y recetas imprimen siempre la cédula de licenciatura.</p>
                    <p class="mt-3 text-left text-sm font-bold text-slate-900">${esc(S.CEDULAS_FIRMA[0].etiqueta)}</p>
                    <p class="text-left text-base font-extrabold text-cyan-800">${esc(valor)}</p>`,
                botones: [{ texto: 'Cerrar', estilo: 'primario' }]
            });
        }
        const checks = S.CEDULAS_FIRMA.map(c => {
            const tiene = !!u[c.campo];
            const on = tiene && (u.cedulas_visibles || []).indexOf(c.codigo) >= 0;
            return `<label class="flex items-start gap-3 rounded-xl border border-slate-200 px-3 py-2 ${tiene ? 'bg-white' : 'bg-slate-50'}">
                <input type="checkbox" data-vis="${esc(c.codigo)}" class="mt-1" ${on ? 'checked' : ''} ${tiene ? '' : 'disabled'}>
                <span><span class="block text-sm font-bold text-slate-800">${esc(c.etiqueta)}</span>
                <span class="block text-xs ${tiene ? 'text-cyan-800 font-bold' : 'text-slate-400'}">${tiene ? esc(u[c.campo]) : 'No registrada. Dirección la captura en Gestión de Personal.'}</span></span>
            </label>`;
        }).join('');
        return modal({
            titulo: 'Mis Cédulas de Firma', subtitulo: 'Elija cuáles de sus cédulas registradas se imprimen en notas, indicaciones y recetas.', icono: 'fa-id-card', ancho: 'md',
            html: `<div class="space-y-2 text-left">${checks}</div><p id="ced-error" class="text-xs text-red-600 mt-3 hidden text-left"></p>`,
            botones: [
                { texto: 'Cancelar', estilo: 'secundario' },
                { texto: 'Guardar impresión', estilo: 'primario', alPulsar: c => {
                    const vis = Array.from(c.el.querySelectorAll('[data-vis]:checked')).map(x => x.getAttribute('data-vis'));
                    const r = S.guardarCedulasVisibles(u.id, vis, S.sesion());
                    const error = c.el.querySelector('#ced-error');
                    if (!r.ok) { error.textContent = r.motivo; error.classList.remove('hidden'); return false; }
                    toast('Las notas, indicaciones y recetas usarán las cédulas seleccionadas.', 'exito');
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
            const precio = enfermeria ? '' : (admin
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
                <p class="text-[11px] text-slate-500">${enfermeria ? 'Usted ve el estudio, la categoría y el tubo. Los importes los registra Caja.' : (admin ? 'Dirección puede corregir un monto en esta orden. El catálogo no cambia.' : 'Precio oficial bloqueado. Caja y el resto del personal no pueden modificarlo.')}</p>
                <p id="toma-error" class="text-xs text-red-600 hidden"></p>
            </div>`,
            alMostrar: c => {
                let tabActiva = bloques[0].id;
                const pintarTubos = () => {
                    const ids = Array.from(c.el.querySelectorAll('[data-est]:checked')).map(x => x.getAttribute('data-est'));
                    const r = S.resumenTubosEstudios(ids);
                    c.el.querySelector('#tubos-resumen').textContent = r.texto
                        ? 'Tubos requeridos/tomados para esta orden: ' + r.texto
                        : (ids.length ? 'Tubos requeridos/tomados para esta orden: ninguno. Los conceptos marcados no piden tubo.' : 'Tubos requeridos/tomados para esta orden: ninguno todavía.');
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
                    toast(enfermeria
                        ? (n + (n === 1 ? ' estudio cargado a la cuenta.' : ' estudios cargados a la cuenta.'))
                        : (n + (n === 1 ? ' estudio cargado' : ' estudios cargados') + ' · ' + S.formatoMoneda(r.total) + ' en la cuenta.'), 'exito');
                    if (op && typeof op.alGuardar === 'function') op.alGuardar(r);
                } }
            ]
        });
    }

    global.BelenUI = { esc, toast, modal, confirmar, aviso, modalSignosVitales, modalHistorial, resumenVisitaHTML, abrirMisCedulas, abrirTerminalEstudios, TIPOS };
})(window);
