// Archivo: js/admin-app.js
// ============================================================
// CONTROLADOR DEL DASHBOARD (vistas por rol y por médico)
// Vistas: central | fila | hospitalizacion | cirugias | expedientes | personal   (?vista=...)
// Datos: BelenStore (js/belen-store.js). Interfaz: BelenUI (js/belen-ui.js).
// CERO alert()/prompt()/confirm() nativos: todo con modales Tailwind.
// ============================================================

const AdminController = {
    rolActual: null,
    sesion: null,
    vista: 'central',
    filtroEspecialidad: '',
    _temporizador: null,
    _pendienteRender: null,

    // roles: quién puede tener la vista. modulo: permiso de módulo (BelenStore.PERMISOS) que el administrador enciende/apaga por usuario.
    VISTAS: {
        central:         { roles: ['admin', 'administrador', 'medico'],                                           modulo: 'ver_consultas',      titulo: { admin: 'Dashboard Central', administrador: 'Dashboard Central', medico: 'Mi Consultorio' } },
        fila:            { roles: ['admin', 'administrador', 'enf_triage', 'enf_hospital', 'enf_quirofano'],      modulo: 'ver_consultas',      titulo: { admin: 'Fila de Espera' } },
        hospitalizacion: { roles: ['admin', 'enf_triage', 'enf_hospital', 'enf_quirofano', 'medico'],             modulo: 'ver_hospitalizados', titulo: { admin: 'Monitor de Camas', medico: 'Mis Pacientes Hospitalizados' } },
        cirugias:        { roles: ['admin', 'administrador', 'enf_triage', 'enf_hospital', 'enf_quirofano'],      modulo: 'ver_quirofano',      titulo: { admin: 'Próximas Cirugías' } },
        expedientes:     { roles: ['admin', 'medico'],                                                            modulo: 'ver_consultas',      titulo: { admin: 'Expedientes Clínicos', medico: 'Expedientes Clínicos' } },
        personal:        { roles: ['admin'],                                                                      modulo: 'gestionar_personal', titulo: { admin: 'Gestión de Personal' } }
    },

    init: async function () {
        BelenStore.sembrarDemoSiHaceFalta();
        if (!this.verificarSesion()) return;
        this.aplicarPermisosUI();

        const pedida = new URLSearchParams(window.location.search).get('vista');
        this.vista = this.vistaPermitida(pedida) ? pedida : this.vistaInicial();
        if (pedida && !this.vistaPermitida(pedida)) {
            BelenUI.toast('Su perfil no tiene acceso a esa sección.', 'alerta');
            if (this.vista) history.replaceState(null, '', '?vista=' + this.vista);
        }
        await this.render();

        // Reloj de espera activo + sincronización entre pestañas (enfermería ↔ médico)
        this._temporizador = setInterval(() => this.actualizarRelojes(), 1000);
        window.addEventListener('storage', (e) => {
            if (e.key && e.key.indexOf('belen_') !== 0) return;
            clearTimeout(this._pendienteRender);
            this._pendienteRender = setTimeout(() => this.render(), 200);
        });
    },

    verificarSesion: function () {
        const s = BelenStore.sesion();
        if (!s) { window.location.href = 'login.html'; return false; }
        this.sesion = s;
        this.rolActual = s.rol;
        document.getElementById('user-name').innerText = s.nombre;
        document.getElementById('user-role').innerText = s.rol === 'medico' ? s.especialidad : s.cargo;
        return true;
    },

    // Sidebar: cada enlace se muestra solo si el rol lo permite (data-roles) Y el módulo está encendido para ESTE usuario (data-modulo).
    // Se vuelve a ejecutar en cada render, así un cambio del administrador se refleja al refrescar o en la siguiente sesión.
    aplicarPermisosUI: function () {
        document.querySelectorAll('[data-roles], [data-modulo]').forEach(el => {
            const roles = el.getAttribute('data-roles');
            const modulo = el.getAttribute('data-modulo');
            const ok = (!roles || roles.split(',').includes(this.rolActual)) && (!modulo || BelenStore.puede(modulo));
            el.style.display = ok ? '' : 'none';
        });
        document.querySelectorAll('[data-proximamente]').forEach(el => {
            if (el.dataset.listo) return;
            el.dataset.listo = '1';
            el.addEventListener('click', (ev) => {
                ev.preventDefault();
                BelenUI.toast('El módulo "' + el.getAttribute('data-proximamente') + '" estará disponible próximamente.', 'info');
            });
        });
    },

    vistaPermitida: function (v) {
        const d = v && this.VISTAS[v];
        return !!d && d.roles.includes(this.rolActual) && (!d.modulo || BelenStore.puede(d.modulo));
    },
    // Primera vista disponible para el usuario (null si el administrador le apagó todos los módulos)
    vistaInicial: function () {
        return ['central', 'fila', 'hospitalizacion', 'cirugias', 'expedientes', 'personal'].find(v => this.vistaPermitida(v)) || null;
    },

    navegar: function (vista, ev) {
        if (ev) ev.preventDefault();
        if (!this.vistaPermitida(vista)) { BelenUI.toast('Su perfil no tiene acceso a esa sección.', 'alerta'); return; }
        this.vista = vista;
        history.replaceState(null, '', '?vista=' + vista);
        this.render();
    },

    cerrarSesion: function () {
        BelenStore.cerrarSesion();
        window.location.href = 'login.html';
    },

    // ======================================================================
    // RENDER
    // ======================================================================
    render: async function () {
        if (!this.sesion) return;
        const cont = document.getElementById('admin-content');
        this.aplicarPermisosUI();
        if (!this.vistaPermitida(this.vista)) {
            const antes = this.vista, nueva = this.vistaInicial();
            if (antes && nueva !== antes) BelenUI.toast('La administración modificó sus permisos: esa sección ya no está disponible.', 'alerta', 5000);
            this.vista = nueva;
            if (nueva) history.replaceState(null, '', '?vista=' + nueva);
        }
        if (!this.vista) {
            document.getElementById('vista-titulo').innerText = 'Sin módulos habilitados';
            cont.innerHTML = `<div class="max-w-lg mx-auto text-center py-20 text-slate-500 bg-white/70 rounded-2xl border border-dashed border-slate-300">
                <i class="fas fa-lock text-4xl text-slate-300 mb-3"></i><p class="font-bold text-slate-700">No tiene módulos habilitados</p>
                <p class="text-sm mt-1">Solicite a la administración que active los módulos que necesita.</p></div>`;
            return;
        }
        const def = this.VISTAS[this.vista];
        document.getElementById('vista-titulo').innerText = def.titulo[this.rolActual] || def.titulo.admin;
        document.querySelectorAll('[data-vista]').forEach(a => {
            const activo = a.getAttribute('data-vista') === this.vista;
            a.classList.toggle('bg-cyan-50', activo); a.classList.toggle('text-cyan-700', activo); a.classList.toggle('font-semibold', activo);
            a.classList.toggle('text-slate-500', !activo); a.classList.toggle('font-medium', !activo);
        });
        if (this.vista === 'central') cont.innerHTML = this.rolActual === 'medico' ? this.htmlMedico() : await this.htmlAdmin();
        else if (this.vista === 'fila') cont.innerHTML = this.htmlFila();
        else if (this.vista === 'hospitalizacion') cont.innerHTML = this.htmlHospitalizacion();
        else if (this.vista === 'cirugias') cont.innerHTML = this.htmlCirugias();
        else if (this.vista === 'expedientes') cont.innerHTML = this.htmlExpedientes();
        else if (this.vista === 'personal') cont.innerHTML = this.htmlPersonal();
        this.actualizarRelojes();
    },

    // ----------------------------------------------------------------------
    // Utilidades de presentación
    // ----------------------------------------------------------------------
    e: function (t) { return BelenUI.esc(t); },

    edadTexto: function (t) {
        const edad = BelenStore.calcularEdad(t.fecha_nacimiento);
        const sexo = t.sexo === 'F' ? 'Femenino' : (t.sexo === 'M' ? 'Masculino' : '');
        return [edad !== null ? edad + ' años' : '', sexo].filter(Boolean).join(' · ');
    },

    // Reloj activo: cuenta desde la llegada; se congela al pasar con el médico
    htmlReloj: function (t) {
        const hasta = t.estatus !== 'pendiente_signos' && t.estatus !== 'signos_capturados' ? (t.pase_en || '') : '';
        return `<span data-reloj="${this.e(t.timestamp_llegada)}" data-hasta="${this.e(hasta)}" class="font-mono font-bold text-slate-700">--:--</span>`;
    },
    actualizarRelojes: function () {
        const ahora = Date.now();
        document.querySelectorAll('[data-reloj]').forEach(el => {
            const desde = Date.parse(el.getAttribute('data-reloj'));
            const hastaTxt = el.getAttribute('data-hasta');
            const hasta = hastaTxt ? Date.parse(hastaTxt) : ahora;
            if (!Number.isFinite(desde)) return;
            const ms = hasta - desde;
            el.textContent = BelenStore.formatoReloj(ms);
            el.classList.toggle('text-red-600', !hastaTxt && ms >= 3600000);
            el.classList.toggle('text-amber-600', !hastaTxt && ms >= 1800000 && ms < 3600000);
            el.classList.toggle('text-slate-700', !!hastaTxt || ms < 1800000);
        });
    },

    htmlSignos: function (t) {
        const r = BelenStore.signosCompletos(t.signos_vitales) ? BelenStore.resumenSignos(t.signos_vitales) : null;
        if (!r) {
            const parcial = !!t.signos_vitales;
            return `<div class="inline-flex items-center gap-2 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                        <i class="fas fa-triangle-exclamation"></i> ${parcial ? 'Signos vitales incompletos' : 'Sin signos vitales'}</div>`;
        }
        const caja = (et, v) => `<div class="bg-slate-50 border border-slate-200 rounded px-2 py-1 text-center"><p class="text-[9px] text-slate-400 uppercase leading-none">${et}</p><p class="text-xs font-bold text-slate-800 mt-0.5">${this.e(v)}</p></div>`;
        return `<div class="grid grid-cols-5 gap-1.5 max-w-sm">${caja('TA', r.ta)}${caja('FC', r.fc)}${caja('FR', r.fr)}${caja('Temp', r.temp)}${caja('SpO2', r.spo2 + '%')}</div>`;
    },

    badgeEstatus: function (t) {
        const mapa = {
            pendiente_signos: 'bg-amber-50 text-amber-700 border-amber-200',
            signos_capturados: 'bg-cyan-50 text-cyan-700 border-cyan-200',
            en_consulta: 'bg-emerald-50 text-emerald-700 border-emerald-200',
            internado_en_proceso: 'bg-indigo-50 text-indigo-700 border-indigo-200',
            internado: 'bg-slate-100 text-slate-700 border-slate-300',
            alta: 'bg-slate-100 text-slate-500 border-slate-200'
        };
        return `<span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${mapa[t.estatus] || mapa.alta}">${this.e(BelenStore.ETIQUETA_ESTATUS[t.estatus] || t.estatus)}</span>`;
    },

    // Caja de turno: el número es la POSICIÓN en la cola de espera (Fila Inteligente), no un folio fijo.
    // Quien está en consulta ya salió de la cola y muestra un ícono en lugar de número.
    htmlTurnoCaja: function (t, oscuro) {
        const fondo = oscuro === false ? 'bg-slate-200 text-slate-700' : 'bg-slate-900 text-white';
        if (!t.posicion) {
            return `<div class="w-16 h-16 rounded-xl bg-emerald-600 text-white flex flex-col items-center justify-center shrink-0" data-posicion="0">
                    <i class="fas fa-user-doctor text-lg"></i><span class="text-[9px] uppercase tracking-wider text-emerald-100 mt-0.5">En consulta</span></div>`;
        }
        return `<div class="w-16 h-16 rounded-xl ${fondo} flex flex-col items-center justify-center shrink-0" data-posicion="${t.posicion}">
                    <span class="text-[9px] uppercase tracking-wider ${oscuro === false ? 'text-slate-500' : 'text-slate-400'}">Turno</span>
                    <span class="text-2xl font-extrabold leading-none">${t.posicion}</span></div>`;
    },

    // ======================================================================
    // VISTA: FILA DE ESPERA INTELIGENTE (admin / administrador / enfermería)
    //   La cola es un arreglo ordenado por llegada: al salir el Turno 1, el Turno 2 se convierte en el Turno 1.
    // ======================================================================
    htmlFila: function () {
        const S = BelenStore;
        const espera = S.colaEspera(this.sesion);
        const consulta = S.pacientesEnConsulta(this.sesion).map(t => Object.assign({}, t, { posicion: 0 }));
        const todos = espera.concat(consulta);
        const filtro = this.filtroEspecialidad;
        const chip = (codigo, texto, n) => {
            const act = filtro === codigo;
            return `<button type="button" data-filtro="${codigo}" onclick="AdminController.filtrarEspecialidad('${codigo}')"
                        class="px-4 py-2 rounded-full text-sm font-semibold border transition ${act ? 'bg-slate-900 text-white border-slate-900 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:border-cyan-400'}">
                        ${this.e(texto)} <span class="ml-1 text-xs ${act ? 'text-slate-300' : 'text-slate-400'}">${n}</span></button>`;
        };
        let chips = chip('', 'Todas', espera.length);
        S.ESPECIALIDADES.forEach(esp => { chips += chip(esp.codigo, esp.nombre, espera.filter(t => t.especialidad_codigo === esp.codigo).length); });

        const espVisibles = S.ESPECIALIDADES.filter(esp => !filtro || esp.codigo === filtro);
        let secciones = '';
        espVisibles.forEach(esp => {
            const enEspera = espera.filter(t => t.especialidad_codigo === esp.codigo);          // arreglo de turnos (ya con posición)
            const conMedico = consulta.filter(t => t.especialidad_codigo === esp.codigo);
            if (!enEspera.length && !conMedico.length && !filtro) return;
            const siguiente = enEspera[0];
            secciones += `<section class="mb-8" data-seccion="${esp.codigo}">
                <h3 class="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3 flex flex-wrap items-center gap-2"><i class="fas fa-stethoscope text-cyan-600"></i> ${this.e(esp.nombre)}
                    <span class="bg-slate-200 text-slate-600 text-[10px] rounded-full px-2 py-0.5" title="Pacientes en espera">${enEspera.length} en espera</span>
                    ${conMedico.length ? `<span class="bg-emerald-100 text-emerald-700 text-[10px] rounded-full px-2 py-0.5">${conMedico.length} en consulta</span>` : ''}
                    ${siguiente ? `<span class="normal-case tracking-normal font-medium text-[11px] text-slate-400">Siguiente: ${this.e(siguiente.paciente_nombre)}</span>` : ''}</h3>
                <div class="flex flex-col gap-3">${(enEspera.length || conMedico.length) ? enEspera.concat(conMedico).map(t => this.htmlTarjetaFila(t)).join('') : '<p class="text-sm text-slate-400 bg-white/60 border border-dashed border-slate-300 rounded-xl p-6 text-center">No hay pacientes en esta fila.</p>'}</div></section>`;
        });
        if (!secciones) secciones = `<div class="text-center py-16 text-slate-400 font-medium bg-white/60 rounded-2xl border border-dashed border-slate-300"><i class="fas fa-user-clock text-4xl mb-3 text-slate-300"></i><p>No hay pacientes en espera.</p></div>`;

        const boton = BelenStore.puede('registrar_paciente') ? this.htmlBotonRegistro() : '';
        const aviso = this.rolActual === 'administrador'
            ? `<div class="mb-6 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl px-4 py-3 flex items-center gap-2"><i class="fas fa-cash-register"></i> Caja y Recepción: registre pacientes, capture sus signos vitales y envíelos con su médico. El turno es la posición en la fila: al pasar el Turno 1 con el médico, el Turno 2 se convierte en el Turno 1.</div>`
            : (S.esEnfermeria(this.rolActual)
                ? `<div class="mb-6 bg-cyan-50 border border-cyan-200 text-cyan-800 text-xs rounded-xl px-4 py-3 flex items-center gap-2"><i class="fas fa-user-nurse"></i> Modo Enfermería: capture o edite signos vitales y envíe al paciente con su médico. El orden de la fila lo define únicamente la hora de llegada.</div>` : '');
        return `<div class="flex flex-wrap justify-between items-end gap-4 mb-6">
                    <div><h2 class="text-2xl font-extrabold text-slate-800">Fila de Espera</h2><p class="text-slate-500">Cola inteligente por especialidad: el número de turno es la posición en la fila y se recorre solo.</p></div>${boton}</div>
                ${aviso}<div class="flex flex-wrap gap-2 mb-6">${chips}</div>${secciones}`;
    },

    filtrarEspecialidad: function (codigo) { this.filtroEspecialidad = codigo; this.render(); },

    htmlBotonRegistro: function () {
        return `<button type="button" id="btn-registrar-paciente" onclick="AdminController.abrirRegistro('admin')" class="bg-cyan-700 hover:bg-cyan-800 text-white font-bold py-3.5 px-7 rounded-xl shadow-md hover:-translate-y-0.5 transition-all flex items-center gap-2 text-base">
                    <i class="fas fa-plus-circle"></i> + Registrar Paciente a Consulta</button>`;
    },

    // Tarjeta de la fila para personal operativo (admin, administrador, enf_*): Capturar Signos + Enviar a Médico
    htmlTarjetaFila: function (t) {
        const enConsulta = t.estatus === 'en_consulta';
        const completos = BelenStore.signosCompletos(t.signos_vitales);
        const borde = enConsulta ? 'border-l-emerald-500' : (completos ? 'border-l-cyan-500' : 'border-l-amber-400');
        const id = this.e(t.turno_id);
        const puedeSignos = BelenStore.puede('capturar_signos');
        const botones = `
            ${puedeSignos ? `<button type="button" data-accion="signos" onclick="AdminController.abrirSignos('${id}')" class="bg-white border border-slate-300 hover:border-cyan-500 hover:text-cyan-700 text-slate-700 text-xs font-bold py-2 px-3 rounded-lg transition flex items-center gap-1.5">
                <i class="fas fa-heart-pulse"></i> ${t.signos_vitales ? 'Editar Signos' : 'Capturar Signos'}</button>` : ''}
            ${enConsulta
                ? `<span class="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2"><i class="fas fa-user-doctor mr-1"></i> Con el médico</span>`
                : (BelenStore.puede('pasar_a_medico') ? `<button type="button" data-accion="pasar" onclick="AdminController.confirmarPase('${id}')" class="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold py-2 px-4 rounded-lg shadow-sm transition flex items-center gap-1.5"><i class="fas fa-arrow-right"></i> Enviar a Médico</button>` : '')}`;
        return `<div data-turno="${id}" class="bg-white rounded-2xl border border-slate-200 border-l-4 ${borde} shadow-sm p-4 flex flex-wrap items-center gap-4">
            ${this.htmlTurnoCaja(t)}
            <div class="flex-1 min-w-[220px]">
                <div class="flex flex-wrap items-center gap-2 mb-0.5"><h4 class="text-lg font-bold text-slate-900">${this.e(t.paciente_nombre)}</h4>${this.badgeEstatus(t)}</div>
                <p class="text-xs text-slate-500">${this.e(this.edadTexto(t))} · <span class="font-semibold text-slate-600">${this.e(t.medico_nombre)}</span></p>
                <p class="text-sm text-slate-600 mt-1"><span class="text-[10px] uppercase text-slate-400 font-bold">Motivo:</span> ${this.e(t.motivo)}</p>
                <div class="mt-2">${this.htmlSignos(t)}</div>
            </div>
            <div class="flex flex-col items-end gap-2 shrink-0">
                <p class="text-[10px] uppercase text-slate-400 font-bold text-right leading-none">${enConsulta ? 'Esperó' : 'Tiempo de espera'}<br><span class="text-lg">${this.htmlReloj(t)}</span></p>
                <div class="flex flex-wrap gap-2 justify-end">${botones}</div>
            </div>
        </div>`;
    },

    // ----------------------------------------------------------------------
    // Signos vitales y pase a médico
    // ----------------------------------------------------------------------
    abrirSignos: function (turnoId) {
        const t = BelenStore.obtenerTurno(turnoId);
        if (!t || !BelenStore.turnoVisiblePara(t, this.sesion)) { BelenUI.toast('No tiene acceso a ese paciente.', 'alerta'); return; }
        BelenUI.modalSignosVitales({ turnoId: turnoId, alGuardar: () => this.render() });
    },

    confirmarPase: function (turnoId) {
        const S = BelenStore, t = S.obtenerTurno(turnoId);
        if (!t || !S.puede('pasar_a_medico')) { BelenUI.toast('No es posible enviar a este paciente.', 'alerta'); return; }
        if (!S.ESTATUS_EN_FILA.includes(t.estatus) || t.estatus === 'en_consulta') { BelenUI.toast('Este paciente ya está con el médico.', 'info'); this.render(); return; }
        const sinSignos = !S.signosCompletos(t.signos_vitales);
        const pos = S.posicionEnCola(turnoId);
        BelenUI.confirmar({
            titulo: `¿Enviar a ${t.paciente_nombre} con ${t.medico_nombre}?`,
            mensaje: sinSignos ? 'El paciente NO tiene signos vitales. ¿Enviar de todos modos?' : `${t.especialidad}${pos ? ' · Turno ' + pos : ''}. El paciente aparecerá destacado en la fila del médico.`,
            tipo: sinSignos ? 'alerta' : 'info',
            textoConfirmar: sinSignos ? 'Enviar de todos modos' : 'Sí, enviar a médico',
            idConfirmar: 'btn-confirmar-pase',
            alConfirmar: () => {
                const r = S.pasarAMedico(turnoId, this.sesion);
                if (r) this.avisarRecorridoDeFila(t, pos, `${t.paciente_nombre} pasó con ${t.medico_nombre}.`);
                this.render();
            }
        });
    },

    // Fila inteligente: avisa quién es ahora el Turno 1 cuando se vacía la primera posición
    avisarRecorridoDeFila: function (t, posicionAnterior, mensajeBase) {
        const sig = BelenStore.siguienteEnCola(t.medico_id);
        const extra = (posicionAnterior === 1 && sig) ? ` ${sig.paciente_nombre} es ahora el Turno 1.` : '';
        BelenUI.toast(mensajeBase + extra, 'exito', extra ? 5500 : 3500);
    },

    // ======================================================================
    // VISTA: MÉDICO (solo su propia fila)
    // ======================================================================
    htmlMedico: function () {
        const S = BelenStore, s = this.sesion;
        // PRIVACIDAD: ambas listas filtran por medico_id. FILA INTELIGENTE: espera es el arreglo de turnos con su posición (1 = siguiente).
        const enConsulta = S.pacientesEnConsulta(s);
        const espera = S.colaEspera(s);
        const hosp = S.hospitalizadosDe(s);

        const tarjetaConsulta = t => {
            const id = this.e(t.turno_id);
            const porEnfermeria = !!t.pase_por_rol && t.pase_por_rol !== 'medico';
            const quienEnvio = String(t.pase_por_rol || '').indexOf('enf') === 0 ? 'Enfermería' : 'Recepción';
            const sinSignos = !S.signosCompletos(t.signos_vitales);
            return `<div data-turno="${id}" data-destacado="1" class="bg-emerald-50 rounded-2xl border-2 border-emerald-400 shadow-md p-5 ring-4 ring-emerald-100">
                <div class="flex flex-wrap items-start gap-4">
                    ${this.htmlTurnoCaja(t)}
                    <div class="flex-1 min-w-[200px]">
                        <span class="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase text-emerald-800 bg-emerald-200/70 rounded px-2 py-0.5 mb-1"><span class="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse"></span> ${porEnfermeria ? quienEnvio + ' le envió este paciente' : 'Consulta en curso'}</span>
                        <h3 class="text-xl font-extrabold text-slate-900">${this.e(t.paciente_nombre)}</h3>
                        <p class="text-xs text-slate-500">${this.e(this.edadTexto(t))}${porEnfermeria && t.pase_por ? ' · Pasó: ' + this.e(t.pase_por) : ''}</p>
                        <p class="text-sm text-slate-700 mt-2"><span class="text-[10px] uppercase text-slate-400 font-bold">Motivo:</span> ${this.e(t.motivo)}</p>
                    </div>
                    <p class="text-[10px] uppercase text-slate-400 font-bold text-right leading-none">Esperó<br><span class="text-lg">${this.htmlReloj(t)}</span></p>
                </div>
                <div class="flex flex-wrap items-center justify-between gap-3 border-t border-emerald-200 pt-3 mt-3">
                    <div>${this.htmlSignos(t)}${sinSignos ? '<p class="text-[11px] text-amber-700 mt-1">Deberá capturar los signos vitales para poder cerrar la Nota Médica.</p>' : ''}</div>
                    <a href="expediente.html?turno=${encodeURIComponent(t.turno_id)}" data-accion="entrar" class="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2.5 rounded-lg text-sm font-bold shadow-sm transition flex items-center gap-2"><i class="fas fa-file-medical"></i> Entrar a Consulta</a>
                </div></div>`;
        };

        const tarjetaEspera = t => {
            const id = this.e(t.turno_id);
            return `<div data-turno="${id}" class="bg-white rounded-2xl border border-slate-200 border-l-4 ${S.signosCompletos(t.signos_vitales) ? 'border-l-cyan-500' : 'border-l-amber-400'} shadow-sm p-4 flex flex-wrap items-center gap-4">
                ${this.htmlTurnoCaja(t)}
                <div class="flex-1 min-w-[200px]">
                    <div class="flex flex-wrap items-center gap-2"><h4 class="text-lg font-bold text-slate-900">${this.e(t.paciente_nombre)}</h4>${this.badgeEstatus(t)}</div>
                    <p class="text-xs text-slate-500">${this.e(this.edadTexto(t))}</p>
                    <p class="text-sm text-slate-600 mt-1"><span class="text-[10px] uppercase text-slate-400 font-bold">Motivo:</span> ${this.e(t.motivo)}</p>
                    <div class="mt-2">${this.htmlSignos(t)}</div>
                </div>
                <div class="flex flex-col items-end gap-2 shrink-0">
                    <p class="text-[10px] uppercase text-slate-400 font-bold text-right leading-none">Tiempo de espera<br><span class="text-lg">${this.htmlReloj(t)}</span></p>
                    <div class="flex flex-wrap gap-2 justify-end">
                        <!-- El médico no captura signos desde la fila: los registra dentro de su nota médica -->
                        <button type="button" data-accion="iniciar" onclick="AdminController.confirmarInicioConsulta('${id}')" class="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold py-2 px-4 rounded-lg shadow-sm transition flex items-center gap-1.5"><i class="fas fa-play"></i> Pasar a Consulta</button>
                    </div>
                </div></div>`;
        };

        return `<div class="flex flex-wrap justify-between items-end gap-4 mb-8">
                    <div><h2 class="text-2xl font-extrabold text-slate-800">Mi Consultorio</h2>
                        <p class="text-slate-500"><span class="font-semibold text-slate-700">${this.e(s.nombre)}</span> · ${this.e(s.especialidad)} · Solo se muestran sus pacientes.</p></div>
                    <button type="button" id="btn-consulta-directa" onclick="AdminController.abrirRegistro('medico')" class="bg-cyan-700 hover:bg-cyan-800 text-white font-bold py-3 px-6 rounded-xl shadow-md transition flex items-center gap-2"><i class="fas fa-plus-circle"></i> Nueva Consulta Directa</button>
                </div>
                <h3 class="text-sm font-bold text-emerald-700 uppercase tracking-wider mb-3 flex items-center gap-2"><i class="fas fa-user-doctor"></i> En consulta <span class="bg-emerald-100 text-emerald-700 text-[10px] rounded-full px-2 py-0.5">${enConsulta.length}</span></h3>
                <div class="flex flex-col gap-4 mb-8" id="medico-en-consulta">${enConsulta.length ? enConsulta.map(tarjetaConsulta).join('') : '<p class="text-sm text-slate-400 bg-white/60 border border-dashed border-slate-300 rounded-xl p-5 text-center">Aún no le han enviado pacientes a consulta.</p>'}</div>
                <h3 class="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2"><i class="fas fa-user-clock text-cyan-600"></i> Mi fila de espera <span class="bg-slate-200 text-slate-600 text-[10px] rounded-full px-2 py-0.5">${espera.length}</span></h3>
                <div class="flex flex-col gap-3 mb-8" id="medico-fila">${espera.length ? espera.map(tarjetaEspera).join('') : '<p class="text-sm text-slate-400 bg-white/60 border border-dashed border-slate-300 rounded-xl p-5 text-center">No hay pacientes en espera en este momento.</p>'}</div>
                <div class="bg-white/80 border border-slate-200 rounded-2xl p-4 flex items-center justify-between">
                    <p class="text-sm text-slate-600"><i class="fas fa-bed-pulse text-indigo-500 mr-2"></i> Pacientes hospitalizados a su cargo o en interconsulta: <b>${hosp.length}</b></p>
                    ${S.puede('ver_hospitalizados') ? `<a href="?vista=hospitalizacion" onclick="AdminController.navegar('hospitalizacion', event)" class="text-xs font-bold text-cyan-700 hover:text-cyan-900">Ver mis hospitalizados <i class="fas fa-arrow-right ml-1"></i></a>` : ''}</div>`;
    },

    confirmarInicioConsulta: function (turnoId) {
        const t = BelenStore.obtenerTurno(turnoId);
        if (!t || !BelenStore.puede('iniciar_consulta') || !BelenStore.turnoVisiblePara(t, this.sesion)) {
            BelenUI.toast('No puede iniciar la consulta de este paciente.', 'alerta'); return;
        }
        const sinSignos = !BelenStore.signosCompletos(t.signos_vitales);
        BelenUI.confirmar({
            titulo: `¿Pasar a consulta a ${t.paciente_nombre}?`,
            mensaje: sinSignos ? 'El paciente aún no tiene signos vitales. Los capturará dentro de su nota médica y no podrá cerrarla sin ellos.' : `${t.especialidad} · Turno ${BelenStore.posicionEnCola(turnoId) || ''}. Al pasar, el siguiente paciente avanza un lugar en su fila.`,
            tipo: sinSignos ? 'alerta' : 'info',
            textoConfirmar: 'Pasar a Consulta',
            idConfirmar: 'btn-confirmar-inicio',
            alConfirmar: () => {
                const r = BelenStore.iniciarConsulta(turnoId, this.sesion);
                if (!r) { BelenUI.toast('No fue posible iniciar la consulta.', 'peligro'); this.render(); return; }
                window.location.href = 'expediente.html?turno=' + encodeURIComponent(turnoId);
            }
        });
    },

    // ======================================================================
    // VISTA: DASHBOARD CENTRAL DE ADMINISTRACIÓN
    // ======================================================================
    htmlAdmin: async function () {
        const S = BelenStore;
        const espera = S.colaEspera(this.sesion);
        const consulta = S.pacientesEnConsulta(this.sesion);
        const hosp = S.puede('ver_hospitalizados') ? S.hospitalizadosDe(this.sesion) : [];
        const tarjetasEsp = S.ESPECIALIDADES.map(esp => {
            const pend = espera.filter(t => t.especialidad_codigo === esp.codigo);
            const cons = consulta.filter(t => t.especialidad_codigo === esp.codigo);
            const proximo = pend[0];
            return `<div class="bg-white/80 border border-slate-200 rounded-2xl p-4 shadow-sm">
                <p class="text-[10px] font-bold text-slate-400 uppercase">${this.e(esp.nombre)}</p>
                <div class="flex items-end gap-4 mt-1">
                    <div><p class="text-3xl font-extrabold text-slate-800 leading-none">${pend.length}</p><p class="text-[10px] text-slate-500">en espera</p></div>
                    <div><p class="text-3xl font-extrabold text-emerald-600 leading-none">${cons.length}</p><p class="text-[10px] text-slate-500">en consulta</p></div>
                </div>
                <p class="text-[11px] text-slate-500 mt-2">${proximo ? 'Turno 1: <b>' + this.e(proximo.paciente_nombre) + '</b>' : 'Sin pacientes en espera'}</p></div>`;
        }).join('');

        const verCirugias = S.puede('ver_quirofano');
        let mock = '';
        if (typeof AdminAPI !== 'undefined') {
            const pacientes = await AdminAPI.obtenerPacientesActivos();
            const proximas = verCirugias ? S.proximasCirugias().slice(0, 3) : [];
            mock = `<div class="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-8">
                <div class="${verCirugias ? 'lg:col-span-6' : 'lg:col-span-12'} flex flex-col gap-4">
                    <h3 class="text-lg font-bold text-slate-800 flex items-center gap-2"><i class="fas fa-procedures text-cyan-600"></i> Pacientes Activos <span class="text-[10px] font-semibold text-slate-400 uppercase">(datos de demostración)</span></h3>
                    ${pacientes.map(p => `
                        <div class="bg-white/80 p-5 rounded-2xl shadow-sm border-l-4 border-${p.colorArea}-500 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-slate-200">
                            <div>
                                <div class="flex items-center gap-2 mb-1"><span class="text-[10px] font-bold uppercase tracking-wider bg-${p.colorArea}-100 text-${p.colorArea}-700 px-2 py-0.5 rounded">${this.e(p.area)}</span></div>
                                <h4 class="text-lg font-extrabold text-slate-900">${this.e(p.nombre)}</h4>
                                <p class="text-sm text-slate-600 font-medium">${this.e(p.servicio)} • <span class="text-slate-500">${this.e(p.medico)}</span></p>
                            </div>
                            <button type="button" onclick="AdminController.verCuentaRapida('${this.e(p.nombre)}', ${Number(p.cuentaActual)})" class="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold py-2 px-4 rounded-xl transition"><i class="fas fa-receipt mr-1"></i> Cuenta Rápida</button>
                        </div>`).join('')}
                </div>
                ${verCirugias ? `<div class="lg:col-span-6 flex flex-col gap-3">
                    <div class="flex items-center justify-between">
                        <h3 class="text-lg font-bold text-slate-800 flex items-center gap-2"><i class="fas fa-kit-medical text-violet-600"></i> Próximas Cirugías</h3>
                        <a href="?vista=cirugias" onclick="AdminController.navegar('cirugias', event)" class="text-xs font-bold text-cyan-700 hover:text-cyan-900">Ver todas <i class="fas fa-arrow-right ml-1"></i></a></div>
                    ${proximas.length ? proximas.map(c => this.htmlTarjetaCirugia(c)).join('') : '<p class="text-sm text-slate-400 bg-white/60 border border-dashed border-slate-300 rounded-xl p-5 text-center">No hay cirugías programadas.</p>'}
                </div>` : ''}</div>`;
        }

        const registro = S.puede('registrar_paciente') ? this.htmlBotonRegistro() : '';
        const metricas = S.puede('ver_metricas') ? this.htmlMetricas() : '';
        const restablecer = this.rolActual === 'admin' ? `
                <div class="mt-10 pt-4 border-t border-slate-200 flex items-center justify-between">
                    <p class="text-xs text-slate-400"><i class="fas fa-gear mr-1"></i> Configuración del demo</p>
                    <button type="button" id="btn-restablecer-demo" onclick="AdminController.confirmarRestablecerDemo()" class="text-xs font-bold text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-2 rounded-lg transition">Restablecer datos de demostración</button></div>` : '';
        return `${metricas}
                <div class="flex flex-wrap justify-between items-end gap-4 mb-6">
                    <div><h2 class="text-2xl font-extrabold text-slate-800">Operación del Día</h2><p class="text-slate-500">Resumen de filas por especialidad${hosp.length || S.puede('ver_hospitalizados') ? ' y pacientes hospitalizados' : ''}.</p></div>
                    ${registro}</div>
                <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">${tarjetasEsp}
                    ${S.puede('ver_hospitalizados') ? `<a href="?vista=hospitalizacion" onclick="AdminController.navegar('hospitalizacion', event)" class="bg-indigo-50 border border-indigo-200 rounded-2xl p-4 shadow-sm hover:shadow-md transition">
                        <p class="text-[10px] font-bold text-indigo-400 uppercase">Hospitalizados</p><p class="text-3xl font-extrabold text-indigo-700 leading-none mt-1">${hosp.length}</p>
                        <p class="text-[11px] text-indigo-600 mt-2">Ver monitor de camas <i class="fas fa-arrow-right ml-1"></i></p></a>` : ''}
                </div>
                ${mock}${restablecer}`;
    },

    // ----------------------------------------------------------------------
    // Métricas centrales de 24 horas (solo admin y administrador). Corte diario a las 7:00 AM.
    // ----------------------------------------------------------------------
    htmlMetricas: function () {
        const m = BelenStore.metricas24h();
        const tarjeta = (id, etiqueta, valor, icono, color) => `<div data-metrica="${id}" class="bg-white/80 border border-slate-200 rounded-xl px-4 py-3 shadow-sm flex items-center gap-3">
                <div class="w-9 h-9 rounded-lg ${color} flex items-center justify-center shrink-0"><i class="fas ${icono} text-sm"></i></div>
                <div><p class="text-2xl font-extrabold text-slate-800 leading-none" data-valor>${valor}</p><p class="text-[10px] font-bold text-slate-400 uppercase mt-1">${etiqueta}</p></div></div>`;
        const maximo = m.por_especialidad.reduce((x, e) => Math.max(x, e.total), 0) || 1;
        // REGLA: por_especialidad solo trae especialidades con más de 0 consultas; no se dibuja ninguna otra.
        const desglose = m.por_especialidad.length
            ? m.por_especialidad.map(e => `<div data-especialidad="${this.e(e.codigo)}" class="flex items-center gap-3">
                    <span class="w-32 shrink-0 text-xs font-semibold text-slate-600 truncate">${this.e(e.nombre)}</span>
                    <div class="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden"><div class="h-full bg-cyan-500 rounded-full" style="width:${Math.round(e.total / maximo * 100)}%"></div></div>
                    <span class="w-6 text-right text-sm font-extrabold text-slate-800">${e.total}</span></div>`).join('')
            : '<p class="text-xs text-slate-400">Aún no hay consultas desde el último corte.</p>';
        return `<section id="barra-metricas" class="mb-8">
                <div class="flex items-center justify-between mb-2"><h3 class="text-[11px] font-bold text-slate-400 uppercase tracking-wider"><i class="fas fa-gauge-high mr-1"></i> Métricas de 24 horas</h3>
                    <p id="metricas-corte" class="text-[11px] text-slate-400"><i class="far fa-clock mr-1"></i>${this.e(m.corte_texto)}</p></div>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    ${tarjeta('espera', 'Pacientes en Espera', m.en_espera, 'fa-user-clock', 'bg-amber-100 text-amber-700')}
                    ${tarjeta('consulta', 'En Consulta', m.en_consulta, 'fa-user-doctor', 'bg-emerald-100 text-emerald-700')}
                    ${tarjeta('total', 'Consultas Totales (24h)', m.consultas_totales, 'fa-clipboard-check', 'bg-cyan-100 text-cyan-700')}
                </div>
                <div id="metricas-desglose" class="mt-3 bg-white/70 border border-slate-200 rounded-xl px-4 py-3">
                    <p class="text-[10px] font-bold text-slate-400 uppercase mb-2">Consultas Totales por Especialidad</p>
                    <div class="flex flex-col gap-2">${desglose}</div></div></section>`;
    },

    // ======================================================================
    // VISTA: PRÓXIMAS CIRUGÍAS (admin, administrador, enf_quirofano; módulo "Quirófano")
    // ======================================================================
    htmlTarjetaCirugia: function (c) {
        const e = t => this.e(t);
        const d = new Date(c.fecha_hora), hoy = new Date();
        const dias = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())) / 86400000);
        const cuando = dias === 0 ? ['Hoy', 'bg-red-100 text-red-700'] : (dias === 1 ? ['Mañana', 'bg-amber-100 text-amber-700'] : ['En ' + dias + ' días', 'bg-slate-100 text-slate-600']);
        const dato = (et, v) => `<div class="min-w-0"><p class="text-[10px] font-bold text-slate-400 uppercase leading-none">${et}</p><p class="text-sm text-slate-800 mt-1 leading-snug">${v}</p></div>`;
        return `<div data-cirugia="${e(c.cirugia_id)}" class="bg-white rounded-2xl border border-slate-200 border-l-4 border-l-violet-500 shadow-sm p-4">
            <div class="flex flex-wrap items-start justify-between gap-2">
                <div class="min-w-0"><h4 class="text-base font-extrabold text-slate-900" data-campo="paciente">${e(c.nombre)}</h4>
                    <p class="text-sm font-semibold text-violet-700 mt-0.5" data-campo="procedimiento"><i class="fas fa-kit-medical mr-1 text-xs"></i>${e(c.procedimiento)}</p></div>
                <div class="text-right shrink-0"><span class="inline-block text-[10px] font-bold uppercase px-2 py-0.5 rounded ${cuando[1]}">${cuando[0]}</span>
                    <p class="text-sm font-bold text-slate-800 mt-1" data-campo="fecha">${e(c.fecha_texto.charAt(0).toUpperCase() + c.fecha_texto.slice(1))}</p>
                    <p class="text-lg font-extrabold text-slate-900 leading-none" data-campo="hora">${e(c.hora_texto)}</p></div>
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3 pt-3 border-t border-slate-100">
                ${dato('Fecha de nacimiento', `<span data-campo="nacimiento">${e(BelenStore.fechaLegibleISO(c.fecha_nacimiento))}</span>`)}
                ${dato('Edad', `<span data-campo="edad">${c.edad !== null ? c.edad + ' años' : '—'}</span>`)}
                ${dato('Médico cirujano', `<span class="font-semibold" data-campo="cirujano">${e(c.medico_cirujano)}</span>${c.medico_especialidad ? `<span class="block text-[11px] text-slate-400">${e(c.medico_especialidad)}</span>` : ''}`)}
            </div>
            <div class="mt-3 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
                <p class="text-[10px] font-bold text-yellow-700 uppercase leading-none mb-1"><i class="fas fa-note-sticky mr-1"></i>Notas</p>
                <p class="text-xs text-slate-800" data-campo="notas">${c.notas ? e(c.notas) : '<span class="text-slate-400 italic">Sin notas registradas.</span>'}</p></div>
        </div>`;
    },

    htmlCirugias: function () {
        const S = BelenStore;
        const lista = S.proximasCirugias();
        const boton = S.puede('programar_cirugia')
            ? `<button type="button" id="btn-programar-cirugia" onclick="AdminController.abrirProgramarCirugia()" class="bg-violet-600 hover:bg-violet-700 text-white font-bold py-3 px-6 rounded-xl shadow-md hover:-translate-y-0.5 transition-all flex items-center gap-2"><i class="fas fa-plus-circle"></i> + Programar Cirugía</button>` : '';
        const aviso = this.rolActual === 'enf_quirofano'
            ? 'Enfermería de Quirófano: consulte la agenda quirúrgica para preparar sala, material y paciente.'
            : 'Agenda quirúrgica ordenada por fecha y hora exacta.';
        return `<div class="flex flex-wrap justify-between items-end gap-4 mb-6">
                    <div><h2 class="text-2xl font-extrabold text-slate-800">Próximas Cirugías</h2><p class="text-slate-500">${this.e(aviso)}</p></div>${boton}</div>
                <div id="lista-cirugias" class="grid grid-cols-1 xl:grid-cols-2 gap-4">${lista.length ? lista.map(c => this.htmlTarjetaCirugia(c)).join('') : '<div class="xl:col-span-2 text-center py-16 text-slate-400 font-medium bg-white/60 rounded-2xl border border-dashed border-slate-300"><i class="fas fa-kit-medical text-4xl mb-3 text-slate-300"></i><p>No hay cirugías programadas.</p></div>'}</div>`;
    },

    abrirProgramarCirugia: function () {
        const S = BelenStore;
        if (!S.puede('programar_cirugia')) { BelenUI.toast('Su perfil no puede programar cirugías.', 'alerta'); return; }
        const cls = 'w-full border border-slate-300 rounded-lg p-2.5 text-sm text-slate-800 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none bg-white';
        const err = k => `<p data-err="${k}" class="text-[11px] text-red-600 mt-1 hidden"></p>`;
        const lab = (id, t, req) => `<label for="${id}" class="block text-[11px] font-bold text-slate-500 uppercase mb-1">${t}${req ? ' <span class="text-red-500">*</span>' : ''}</label>`;
        const ahora = new Date(), pad = n => String(n).padStart(2, '0');
        const minimo = `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-${pad(ahora.getDate())}T${pad(ahora.getHours())}:${pad(ahora.getMinutes())}`;
        const medicos = S.cirujanos().map(m => `<option value="${m.id}">${this.e(m.nombre)} · ${this.e(m.cargo)}</option>`).join('');
        BelenUI.modal({
            titulo: 'Programar Cirugía', subtitulo: 'Todos los datos se mostrarán en la tarjeta de la agenda quirúrgica.', icono: 'fa-kit-medical', ancho: 'lg',
            html: `<div class="grid grid-cols-1 sm:grid-cols-6 gap-4">
                <div class="sm:col-span-6">${lab('cx-nombre', 'Nombre completo del paciente', true)}<input id="cx-nombre" type="text" autocomplete="off" placeholder="Nombre y apellidos" class="${cls}" data-autofoco>${err('nombre')}</div>
                <div class="sm:col-span-3">${lab('cx-fecha_nacimiento', 'Fecha de nacimiento', true)}<input id="cx-fecha_nacimiento" type="date" min="1900-01-01" max="${S.hoyLocal()}" class="${cls}">${err('fecha_nacimiento')}</div>
                <div class="sm:col-span-3">${lab('cx-edad', 'Edad')}<input id="cx-edad" type="text" readonly tabindex="-1" placeholder="Se calcula sola" class="${cls} bg-slate-50 text-slate-500"></div>
                <div class="sm:col-span-6">${lab('cx-procedimiento', 'Nombre de la cirugía', true)}<input id="cx-procedimiento" type="text" maxlength="120" placeholder="Ej. Colecistectomía laparoscópica" class="${cls}">${err('procedimiento')}</div>
                <div class="sm:col-span-3">${lab('cx-fecha_hora', 'Fecha y hora exacta', true)}<input id="cx-fecha_hora" type="datetime-local" min="${minimo}" step="300" class="${cls}">${err('fecha_hora')}</div>
                <div class="sm:col-span-3">${lab('cx-medico_cirujano_id', 'Médico cirujano', true)}<select id="cx-medico_cirujano_id" class="${cls}"><option value="">Seleccione…</option>${medicos}</select>${err('medico_cirujano_id')}</div>
                <div class="sm:col-span-6">${lab('cx-notas', 'Notas')}<textarea id="cx-notas" rows="2" maxlength="600" placeholder="Preparación, alergias, pendientes administrativos…" class="${cls} resize-none"></textarea>${err('notas')}</div>
            </div>`,
            alMostrar: c => {
                const fn = c.el.querySelector('#cx-fecha_nacimiento'), ed = c.el.querySelector('#cx-edad');
                const calc = () => { const x = S.calcularEdad(fn.value); ed.value = x !== null ? x + ' años' : ''; };
                fn.addEventListener('input', calc); fn.addEventListener('change', calc);
                c.el.querySelectorAll('input,select,textarea').forEach(i => i.addEventListener('input', () => {
                    const p = c.el.querySelector(`[data-err="${i.id.replace('cx-', '')}"]`); if (p) p.classList.add('hidden'); i.classList.remove('border-red-500');
                }));
            },
            botones: [
                { texto: 'Cancelar', estilo: 'secundario' },
                { texto: 'Guardar Cirugía', estilo: 'primario', id: 'cx-guardar', alPulsar: c => {
                    const q = sel => c.el.querySelector(sel);
                    const r = S.programarCirugia({
                        nombre: q('#cx-nombre').value, fecha_nacimiento: q('#cx-fecha_nacimiento').value, procedimiento: q('#cx-procedimiento').value,
                        fecha_hora: q('#cx-fecha_hora').value, medico_cirujano_id: q('#cx-medico_cirujano_id').value, notas: q('#cx-notas').value
                    }, this.sesion);
                    if (!r.ok) {
                        c.el.querySelectorAll('[data-err]').forEach(p => p.classList.add('hidden'));
                        Object.keys(r.errores || {}).forEach(k => {
                            const p = q(`[data-err="${k}"]`); if (p) { p.textContent = r.errores[k]; p.classList.remove('hidden'); }
                            const i = q('#cx-' + k); if (i) i.classList.add('border-red-500');
                        });
                        if (!r.errores) BelenUI.toast(r.motivo, 'peligro');
                        return false;
                    }
                    BelenUI.toast('Cirugía programada: ' + r.cirugia.procedimiento + '.', 'exito');
                    this.render();
                } }
            ]
        });
    },

    verCuentaRapida: function (nombre, monto) {
        BelenUI.aviso('Pre-cuenta de ' + nombre, 'Cuenta actual: ' + monto.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }), 'info');
    },

    confirmarRestablecerDemo: function () {
        BelenUI.confirmar({
            titulo: '¿Restablecer los datos de demostración?', tipo: 'peligro', textoConfirmar: 'Sí, restablecer',
            mensaje: 'Se borrarán filas, turnos, borradores, visitas, hospitalizados y cirugías guardados en este navegador y se cargarán los pacientes de ejemplo.',
            alConfirmar: () => { BelenStore.restablecerDemo(); BelenUI.toast('Datos de demostración restablecidos.', 'exito'); this.render(); }
        });
    },

    // ======================================================================
    // VISTA: MONITOR DE CAMAS / HOSPITALIZADOS (por rol)
    // ======================================================================
    htmlHospitalizacion: function () {
        const S = BelenStore, s = this.sesion, e = t => this.e(t);
        // PRIVACIDAD: admin y enfermería ven todos; el médico solo a sus pacientes (tratante) o los que le solicitaron en interconsulta
        const lista = S.hospitalizadosDe(s).map(t => S.fichaHospitalizado(t, s));
        const esEnf = S.esEnfermeria(s.rol);
        const modo = esEnf ? 'Modo Enfermería: asigne camas y complete la Hoja Frontal y los Consentimientos; la Nota Médica y las Indicaciones son solo del médico.' :
                     (s.rol === 'medico' ? 'Solo se muestran los pacientes a su cargo y los que le fueron solicitados en interconsulta.' : 'Vista completa de todos los pacientes hospitalizados.');
        const sexoTxt = f => f.sexo === 'F' ? 'Femenino' : (f.sexo === 'M' ? 'Masculino' : '');
        const dato = (et, v) => `<div class="min-w-0"><p class="text-[10px] font-bold text-slate-400 uppercase leading-none">${et}</p><p class="text-sm text-slate-800 mt-1 leading-snug">${v}</p></div>`;
        const tarjeta = f => {
            const enProceso = !f.finalizado;
            const alergia = f.alergias
                ? `<span data-alergias="1" class="inline-flex items-center gap-1.5 text-xs font-bold text-red-700 bg-red-50 border border-red-300 rounded-lg px-2.5 py-1"><i class="fas fa-triangle-exclamation"></i> ${e(f.alergias)}</span>`
                : `<span data-alergias="0" class="text-xs text-slate-400">Ninguna referida</span>`;
            const relacion = f.relacion === 'interconsultante'
                ? '<span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded border bg-indigo-50 text-indigo-700 border-indigo-200"><i class="fas fa-user-doctor mr-1"></i>Interconsulta</span>' : '';
            let accion;
            if (f.finalizado) {
                const idv = encodeURIComponent(f.internamiento_id || f.turno_id);
                accion = `<a href="expediente.html?modo=hospitalizado&id=${idv}" data-accion="abrir-expediente" class="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold py-2.5 px-4 rounded-lg shadow-sm transition flex items-center gap-2"><i class="fas fa-folder-tree"></i> Ver Expediente</a>`;
            } else if (f.relacion === 'interconsultante') {
                accion = `<span class="text-[11px] font-semibold text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">Papeleo de ingreso en curso</span>`;
            } else {
                const txt = esEnf ? 'Completar Hoja Frontal y Consentimientos' : 'Continuar Expediente';
                const ico = esEnf ? 'fa-clipboard-list' : 'fa-file-medical';
                const cls = esEnf ? 'bg-cyan-700 hover:bg-cyan-800 text-white' : 'bg-slate-900 hover:bg-slate-800 text-white';
                accion = `<a href="expediente.html?turno=${encodeURIComponent(f.turno_id)}" data-accion="abrir-expediente" class="${cls} text-xs font-bold py-2.5 px-4 rounded-lg shadow-sm transition flex items-center gap-2"><i class="fas ${ico}"></i> ${txt}</a>`;
            }
            const botonCama = S.puede('asignar_cama')
                ? `<button type="button" data-accion="asignar-cama" onclick="AdminController.abrirAsignarCama('${e(f.turno_id)}')" class="bg-white border border-slate-300 hover:border-cyan-500 hover:text-cyan-700 text-slate-700 text-xs font-bold py-2 px-3 rounded-lg transition flex items-center gap-1.5"><i class="fas fa-bed"></i> ${f.cama ? 'Cambiar cama' : 'Asignar cama'}</button>` : '';
            const ics = f.interconsultas.length
                ? f.interconsultas.map(x => `<span class="inline-block bg-indigo-50 text-indigo-700 border border-indigo-200 rounded px-1.5 py-0.5 text-[10px] font-bold mr-1">${e(x.especialidad)} · ${e(x.medico_nombre)}</span>`).join('') : '';
            return `<div data-turno="${e(f.turno_id)}" data-paciente="${e(f.paciente_id)}" class="bg-white rounded-2xl border border-slate-200 border-l-4 ${enProceso ? 'border-l-indigo-500' : 'border-l-slate-400'} shadow-sm p-5">
                <div class="flex flex-wrap items-start gap-4">
                    <div class="min-w-[4rem] max-w-[7rem] min-h-[4rem] py-1 rounded-xl ${f.cama ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400 border border-dashed border-slate-300'} flex flex-col items-center justify-center shrink-0 text-center px-1">
                        <i class="fas fa-bed text-sm"></i><span data-cama="1" class="text-[11px] font-extrabold leading-tight mt-0.5 break-words">${f.cama ? e(f.cama) : 'Sin cama'}</span></div>
                    <div class="flex-1 min-w-[240px]">
                        <div class="flex flex-wrap items-center gap-2"><h4 class="text-lg font-bold text-slate-900">${e(f.nombre)}</h4>${this.badgeEstatus({ estatus: f.estatus })}${relacion}</div>
                        <p class="text-xs text-slate-500">${f.edad !== null ? f.edad + ' años' : ''}${sexoTxt(f) ? ' · ' + sexoTxt(f) : ''}${f.area ? ' · ' + e(f.area) : ''}</p>
                    </div>
                    <div class="flex flex-wrap gap-2 justify-end">${botonCama}${accion}</div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 pt-4 border-t border-slate-100">
                    ${dato('Médico tratante', `<span class="font-semibold">${e(f.medico_tratante)}</span><span class="block text-[11px] text-slate-400">${e(f.especialidad)}</span>`)}
                    ${dato('Diagnóstico actual', f.diagnostico_actual ? e(f.diagnostico_actual) : '<span class="text-slate-400">No registrado</span>')}
                    ${dato('Alergias', alergia)}
                </div>
                ${ics ? `<p class="mt-3 text-[11px] text-slate-500"><span class="font-bold uppercase text-slate-400 text-[10px]">Interconsultas:</span> ${ics}</p>` : ''}
            </div>`;
        };
        return `<div class="mb-6"><h2 class="text-2xl font-extrabold text-slate-800">Monitor de Camas</h2><p class="text-slate-500">Pacientes en observación u hospitalización.</p></div>
                <div class="mb-6 bg-cyan-50 border border-cyan-200 text-cyan-800 text-xs rounded-xl px-4 py-3 flex items-center gap-2"><i class="fas fa-circle-info"></i> ${this.e(modo)}</div>
                <div class="flex flex-col gap-3" id="lista-hospitalizados">${lista.length ? lista.map(tarjeta).join('') : '<div class="text-center py-16 text-slate-400 font-medium bg-white/60 rounded-2xl border border-dashed border-slate-300"><i class="fas fa-bed text-4xl mb-3 text-slate-300"></i><p>No hay pacientes hospitalizados.</p></div>'}</div>`;
    },

    // Asignación de cama (Enfermería o Administración). Cama única por paciente activo.
    abrirAsignarCama: function (turnoId) {
        const S = BelenStore, t = S.obtenerTurno(turnoId);
        if (!t || !S.puede('asignar_cama') || !S.hospitalizadoVisiblePara(t, this.sesion)) { BelenUI.toast('No puede asignar cama a este paciente.', 'alerta'); return; }
        const i = S.internamientoDeTurno(turnoId);
        BelenUI.modal({
            titulo: 'Asignar cama', subtitulo: t.paciente_nombre, icono: 'fa-bed', ancho: 'sm',
            html: `<label for="cama-valor" class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Cama o habitación</label>
                <input id="cama-valor" type="text" maxlength="40" autocomplete="off" value="${this.e(i && i.cama ? i.cama : '')}" placeholder="Ej. Habitación 204, Cama A" data-autofoco
                    class="w-full border border-slate-300 rounded-lg p-2.5 text-sm text-slate-800 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none bg-white">
                <p id="cama-error" class="text-[11px] text-red-600 mt-1 hidden"></p>`,
            alMostrar: c => c.el.querySelector('#cama-valor').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); c.el.querySelector('#cama-guardar').click(); } }),
            botones: [
                { texto: 'Cancelar', estilo: 'secundario' },
                { texto: 'Guardar cama', estilo: 'primario', id: 'cama-guardar', alPulsar: c => {
                    const r = S.asignarCama(turnoId, c.el.querySelector('#cama-valor').value, this.sesion);
                    if (!r.ok) { const m = c.el.querySelector('#cama-error'); m.textContent = r.motivo; m.classList.remove('hidden'); c.el.querySelector('#cama-valor').classList.add('border-red-500'); return false; }
                    BelenUI.toast(`Cama "${r.internamiento.cama}" asignada a ${t.paciente_nombre}.`, 'exito');
                    this.render();
                } }
            ]
        });
    },

    // ======================================================================
    // VISTA: GESTIÓN DE PERSONAL (exclusiva del administrador): permisos dinámicos por módulo
    // ======================================================================
    htmlPersonal: function () {
        const S = BelenStore, e = t => this.e(t);
        const interruptor = (u, m) => {
            if (!S.moduloAplicaARol(m.permiso, u.rol)) {
                return `<span data-sin-modulo="1" title="Este módulo no aplica al perfil ${e(S.ROLES[u.rol].etiqueta)}" class="text-slate-300 text-lg leading-none">&mdash;</span>`;
            }
            const activo = S.permisoModuloDe(u.id, m.permiso), fijo = u.rol === 'admin';
            return `<button type="button" role="switch" aria-checked="${activo}" aria-label="${e(m.etiqueta)} para ${e(u.nombre)}" data-switch="1" data-usuario="${e(u.id)}" data-permiso="${m.permiso}" ${fijo ? 'disabled' : ''}
                    onclick="AdminController.alternarModulo('${e(u.id)}','${m.permiso}')"
                    class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${activo ? 'bg-cyan-600' : 'bg-slate-300'} ${fijo ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}">
                    <span class="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${activo ? 'translate-x-6' : 'translate-x-1'}"></span></button>`;
        };
        const ajustes = S.leerPermisosPersonal();
        const filas = Object.values(S.USUARIOS).map(u => {
            const rol = S.ROLES[u.rol];
            const esp = u.rol === 'medico' ? (S.especialidadPorCodigo(u.especialidad_codigo) || {}).nombre : u.cargo;
            const personalizado = !!ajustes[u.id] && Object.keys(ajustes[u.id]).length > 0;
            return `<tr class="border-t border-slate-100 hover:bg-slate-50/70" data-usuario-fila="${e(u.id)}">
                <td class="px-4 py-3"><div class="flex items-center gap-3">
                    <div class="w-9 h-9 rounded-full ${rol.color} flex items-center justify-center text-xs font-bold shrink-0">${e(S.iniciales(u.nombre.replace(/^(Dr\.|Enf\.|Adm\.)\s*/, '')))}</div>
                    <div><p class="font-bold text-slate-800 leading-tight">${e(u.nombre)}</p><p class="text-[11px] text-slate-400 font-mono">${e(u.id)}</p></div></div></td>
                <td class="px-4 py-3"><span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded whitespace-nowrap ${rol.color}">${e(rol.corta)}</span><p class="text-xs text-slate-500 mt-1">${e(esp || '')}</p></td>
                ${S.MODULOS.map(m => `<td class="px-4 py-3 text-center">${interruptor(u, m)}</td>`).join('')}
                <td class="px-4 py-3 text-right">${u.rol === 'admin'
                    ? '<span class="text-[11px] text-slate-400">Acceso total</span>'
                    : (personalizado ? `<button type="button" data-accion="restablecer-usuario" onclick="AdminController.restablecerUsuario('${e(u.id)}')" class="text-[11px] font-bold text-slate-500 hover:text-cyan-700 underline underline-offset-2">Valores del perfil</button>` : '<span class="text-[11px] text-slate-300">Valores del perfil</span>')}</td></tr>`;
        }).join('');
        return `<div class="mb-6"><h2 class="text-2xl font-extrabold text-slate-800">Gestión de Personal</h2>
                    <p class="text-slate-500">Encienda o apague módulos por empleado. Un módulo apagado desaparece del menú lateral de esa persona y uno encendido aparece en su navegación.</p></div>
                <div class="mb-6 bg-cyan-50 border border-cyan-200 text-cyan-800 text-xs rounded-xl px-4 py-3 flex items-start gap-2"><i class="fas fa-circle-info mt-0.5"></i>
                    <span>Los cambios se guardan al instante y se aplican en la siguiente sesión del empleado (o en cuanto actualice su pantalla). Alfonso conserva siempre todos los módulos. Un guion (&mdash;) indica que el módulo no aplica a ese perfil.</span></div>
                <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-x-auto"><table class="w-full text-sm text-left" id="tabla-personal">
                    <thead class="bg-slate-50 text-[11px] uppercase text-slate-400"><tr><th class="px-4 py-3">Personal</th><th class="px-4 py-3">Perfil</th>
                        ${S.MODULOS.map(m => `<th class="px-4 py-3 text-center whitespace-nowrap"><i class="fas ${m.icono} mr-1 text-slate-400"></i>${e(m.etiqueta)}</th>`).join('')}<th class="px-4 py-3"></th></tr></thead>
                    <tbody>${filas}</tbody></table></div>
                <div class="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">${S.MODULOS.map(m => `<div class="bg-white/70 border border-slate-200 rounded-xl px-4 py-3"><p class="text-xs font-bold text-slate-700"><i class="fas ${m.icono} text-cyan-600 mr-1"></i>${e(m.etiqueta)}</p><p class="text-[11px] text-slate-500 mt-0.5">${e(m.descripcion)}</p></div>`).join('')}</div>`;
    },

    alternarModulo: function (usuarioId, permiso) {
        const S = BelenStore;
        if (!S.puede('gestionar_personal')) { BelenUI.toast('Solo la administración puede cambiar permisos.', 'alerta'); return; }
        const u = S.USUARIOS[usuarioId], m = S.MODULOS.find(x => x.permiso === permiso);
        if (!u || !m) return;
        const nuevo = !S.permisoModuloDe(usuarioId, permiso);
        if (!S.establecerPermisoModulo(usuarioId, permiso, nuevo)) { BelenUI.toast('No se pudo guardar el permiso.', 'peligro'); return; }
        BelenUI.toast(`${m.etiqueta}: ${nuevo ? 'activado' : 'desactivado'} para ${u.nombre}.`, nuevo ? 'exito' : 'info');
        this.render();
    },

    restablecerUsuario: function (usuarioId) {
        const u = BelenStore.USUARIOS[usuarioId];
        if (!u || !BelenStore.puede('gestionar_personal')) return;
        BelenStore.restablecerPermisosPersonal(usuarioId);
        BelenUI.toast(`${u.nombre}: permisos restablecidos a los valores de su perfil.`, 'info');
        this.render();
    },

    // ======================================================================
    // VISTA: EXPEDIENTES CLÍNICOS (catálogo longitudinal)
    // ======================================================================
    pacientesVisibles: function () {
        const S = BelenStore, s = this.sesion;
        const cat = S.listarPacientes();
        if (s.rol === 'admin') return cat;
        // Médico: solo pacientes que ha atendido o que tiene asignados
        const mios = new Set();
        S.listarVisitas().forEach(v => { if (v.meta && v.meta.medico_id === s.medico_id) mios.add(v.meta.paciente_id); });
        S.listarTurnos().forEach(t => { if (t.medico_id === s.medico_id) mios.add(t.paciente_id); });
        return cat.filter(p => mios.has(p.paciente_id));
    },

    htmlExpedientes: function () {
        const S = BelenStore;
        const pacientes = this.pacientesVisibles();
        const filas = pacientes.map(p => {
            const v = S.visitasDePaciente(p.paciente_id);
            const edad = S.calcularEdad(p.fecha_nacimiento);
            const ultima = v[0] && v[0].consulta && v[0].consulta.fecha_hora ? S.fechaLegibleISO(v[0].consulta.fecha_hora.slice(0, 10)) : '—';
            return `<tr class="border-t border-slate-100 hover:bg-slate-50" data-paciente="${this.e(p.paciente_id)}">
                <td class="px-4 py-3 font-bold text-slate-800">${this.e(p.nombre_completo)}<span class="block text-[11px] font-normal text-slate-400">${this.e(p.paciente_id)}</span></td>
                <td class="px-4 py-3 text-slate-600">${edad !== null ? edad + ' años' : '—'} · ${p.sexo === 'F' ? 'Femenino' : 'Masculino'}</td>
                <td class="px-4 py-3 text-slate-600 text-center">${v.length}</td>
                <td class="px-4 py-3 text-slate-600">${ultima}</td>
                <td class="px-4 py-3 text-right"><button type="button" data-accion="ver-visitas" onclick="AdminController.verVisitasPaciente('${this.e(p.paciente_id)}')" class="text-xs font-bold text-cyan-700 hover:text-cyan-900 bg-cyan-50 hover:bg-cyan-100 rounded-lg px-3 py-1.5 transition" ${v.length ? '' : 'disabled style="opacity:.4;cursor:not-allowed"'}>Ver visitas</button></td></tr>`;
        }).join('');
        return `<div class="mb-6"><h2 class="text-2xl font-extrabold text-slate-800">Expedientes Clínicos</h2>
                    <p class="text-slate-500">${this.rolActual === 'medico' ? 'Pacientes que usted ha atendido o tiene asignados.' : 'Catálogo longitudinal de pacientes.'}</p></div>
                <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"><table class="w-full text-sm text-left">
                    <thead class="bg-slate-50 text-[11px] uppercase text-slate-400"><tr><th class="px-4 py-3">Paciente</th><th class="px-4 py-3">Edad y sexo</th><th class="px-4 py-3 text-center">Visitas</th><th class="px-4 py-3">Última visita</th><th class="px-4 py-3"></th></tr></thead>
                    <tbody>${filas || '<tr><td colspan="5" class="px-4 py-10 text-center text-slate-400">No hay expedientes para mostrar.</td></tr>'}</tbody></table></div>`;
    },

    verVisitasPaciente: function (pacienteId) {
        const p = BelenStore.buscarPacientePorId(pacienteId);
        if (!p || !this.pacientesVisibles().some(x => x.paciente_id === pacienteId)) { BelenUI.toast('No tiene acceso a ese expediente.', 'alerta'); return; }
        BelenUI.modalHistorial({ pacienteId: pacienteId });
    },

    // ======================================================================
    // REGISTRO DE PACIENTE A CONSULTA (admin) / CONSULTA DIRECTA (médico)
    // ======================================================================
    abrirRegistro: function (modo) {
        const S = BelenStore, s = this.sesion;
        const esMedico = modo === 'medico';
        if (!S.puede(esMedico ? 'registrar_consulta_directa' : 'registrar_paciente')) { BelenUI.toast('Su perfil no puede registrar pacientes.', 'alerta'); return; }
        const hoy = S.hoyLocal();
        const optsEsp = S.ESPECIALIDADES.filter(x => !esMedico || x.codigo === s.especialidad_codigo)
            .map(x => `<option value="${x.codigo}">${this.e(x.nombre)}</option>`).join('');
        const cls = 'w-full border border-slate-300 rounded-lg p-2.5 text-sm text-slate-800 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none bg-white';
        const campoErr = k => `<p data-err="${k}" class="text-[11px] text-red-600 mt-1 hidden"></p>`;
        const html = `
            <div class="grid grid-cols-1 sm:grid-cols-6 gap-4">
                <div class="sm:col-span-6 relative">
                    <label for="reg-nombre" class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Nombre completo del paciente <span class="text-red-500">*</span></label>
                    <input id="reg-nombre" type="text" autocomplete="off" placeholder="Nombre y apellidos" class="${cls}" data-autofoco>
                    <div id="reg-sugerencias" class="hidden absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 overflow-hidden"></div>
                    ${campoErr('nombre')}
                </div>
                <div class="sm:col-span-3">
                    <label for="reg-fn" class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Fecha de nacimiento <span class="text-red-500">*</span></label>
                    <input id="reg-fn" type="date" min="1900-01-01" max="${hoy}" class="${cls}">${campoErr('fn')}
                </div>
                <div class="sm:col-span-3">
                    <label for="reg-sexo" class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Sexo <span class="text-red-500">*</span></label>
                    <select id="reg-sexo" class="${cls}"><option value="">Seleccione…</option><option value="F">Femenino</option><option value="M">Masculino</option></select>${campoErr('sexo')}
                </div>
                <div id="reg-estado" class="sm:col-span-6 hidden"></div>
                <div class="sm:col-span-3">
                    <label for="reg-especialidad" class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Especialidad <span class="text-red-500">*</span></label>
                    <select id="reg-especialidad" class="${cls}" ${esMedico ? 'disabled' : ''}>${esMedico ? '' : '<option value="">Seleccione…</option>'}${optsEsp}</select>${campoErr('especialidad')}
                </div>
                <div class="sm:col-span-3">
                    <label for="reg-medico" class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Médico <span class="text-red-500">*</span></label>
                    <select id="reg-medico" class="${cls}" ${esMedico ? 'disabled' : ''}><option value="">Seleccione una especialidad…</option></select>${campoErr('medico')}
                </div>
                <div class="sm:col-span-6">
                    <label for="reg-motivo" class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Motivo de llegada <span class="text-red-500">*</span></label>
                    <textarea id="reg-motivo" rows="2" placeholder="Ej. Dolor abdominal desde hace 2 horas" class="${cls} resize-none"></textarea>${campoErr('motivo')}
                </div>
            </div>`;
        BelenUI.modal({
            titulo: esMedico ? 'Nueva Consulta Directa' : 'Registrar Paciente a Consulta',
            subtitulo: esMedico ? 'Se registrará en su propia fila y se iniciará la consulta.' : 'Busque al paciente, elija especialidad y médico.',
            icono: 'fa-user-plus', ancho: 'lg', html: html,
            alMostrar: c => this._montarRegistro(c, esMedico),
            botones: [
                { texto: 'Cancelar', estilo: 'secundario' },
                { texto: 'Revisar y Confirmar', estilo: 'primario', id: 'reg-continuar', alPulsar: c => { this._revisarRegistro(c, esMedico); return false; } }
            ]
        });
    },

    _montarRegistro: function (c, esMedico) {
        const S = BelenStore, s = this.sesion;
        const q = sel => c.el.querySelector(sel);
        const nombre = q('#reg-nombre'), fn = q('#reg-fn'), sexo = q('#reg-sexo'), esp = q('#reg-especialidad'), med = q('#reg-medico');
        c.coincidencia = null;

        const llenarMedicos = () => {
            const lista = esp.value ? S.medicosDeEspecialidad(esp.value) : [];
            med.innerHTML = (lista.length === 1 ? '' : `<option value="">${esp.value ? 'Seleccione…' : 'Seleccione una especialidad…'}</option>`) +
                lista.map(m => `<option value="${m.medico_id}">${this.e(m.nombre)}</option>`).join('');
        };
        const mostrarEstado = (html) => { const b = q('#reg-estado'); b.innerHTML = html || ''; b.classList.toggle('hidden', !html); };

        const evaluar = () => {
            const n = S.limpiarEspacios(nombre.value);
            const m = S.buscarPacientePorIdentidad(n, fn.value);
            c.coincidencia = m;
            if (m) {
                sexo.value = m.sexo || ''; sexo.disabled = true;
                const visitas = S.visitasDePaciente(m.paciente_id).length;
                mostrarEstado(`<div id="reg-badge-encontrado" class="flex items-center gap-3 bg-emerald-50 border border-emerald-300 rounded-lg px-4 py-3">
                    <i class="fas fa-folder-open text-emerald-600 text-xl"></i>
                    <div><p class="text-sm font-bold text-emerald-800">Expediente Encontrado</p>
                    <p class="text-xs text-emerald-700">Vinculado al paciente <b>${this.e(m.paciente_id)}</b> · ${visitas} ${visitas === 1 ? 'visita previa' : 'visitas previas'}</p></div></div>`);
            } else {
                sexo.disabled = false;
                if (n.length >= 5 && fn.value) {
                    const homo = S.homonimos(n, fn.value);
                    mostrarEstado(homo.length
                        ? `<div class="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-800"><i class="fas fa-triangle-exclamation mt-0.5"></i><p>Existe un paciente con el mismo nombre pero otra fecha de nacimiento (${this.e(S.fechaLegibleISO(homo[0].fecha_nacimiento))}). Se creará un expediente nuevo.</p></div>`
                        : `<div class="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-xs text-slate-600"><i class="fas fa-user-plus text-slate-400"></i><p>Paciente nuevo: se creará un expediente al confirmar.</p></div>`);
                } else mostrarEstado('');
            }
        };

        const sugerencias = () => {
            const caja = q('#reg-sugerencias');
            const res = c.coincidencia ? [] : S.buscarPacientesPorNombre(nombre.value, 5);
            if (!res.length || nombre.value.trim().length < 3) { caja.classList.add('hidden'); return; }
            caja.innerHTML = res.map(p => `<button type="button" data-sug="${this.e(p.paciente_id)}" class="w-full text-left px-3 py-2 hover:bg-cyan-50 border-b border-slate-100 last:border-0">
                <span class="block text-sm font-semibold text-slate-800">${this.e(p.nombre_completo)}</span>
                <span class="block text-[11px] text-slate-500">${this.e(S.fechaLegibleISO(p.fecha_nacimiento))} · ${this.e(p.paciente_id)}</span></button>`).join('');
            caja.classList.remove('hidden');
            caja.querySelectorAll('[data-sug]').forEach(b => b.addEventListener('mousedown', ev => {
                ev.preventDefault();
                const p = S.buscarPacientePorId(b.getAttribute('data-sug'));
                nombre.value = p.nombre_completo; fn.value = p.fecha_nacimiento; sexo.value = p.sexo || '';
                caja.classList.add('hidden'); evaluar();
            }));
        };

        nombre.addEventListener('input', () => { evaluar(); sugerencias(); });
        nombre.addEventListener('blur', () => setTimeout(() => q('#reg-sugerencias').classList.add('hidden'), 120));
        fn.addEventListener('input', evaluar); fn.addEventListener('change', evaluar);
        esp.addEventListener('change', llenarMedicos);

        if (esMedico) { esp.value = s.especialidad_codigo; llenarMedicos(); med.value = s.medico_id; }
        c.el.querySelectorAll('input,select,textarea').forEach(i => i.addEventListener('input', () => {
            const err = c.el.querySelector(`[data-err="${i.id.replace('reg-', '')}"]`);
            if (err) err.classList.add('hidden'); i.classList.remove('border-red-500');
        }));
    },

    _revisarRegistro: function (c, esMedico) {
        const S = BelenStore;
        const q = sel => c.el.querySelector(sel);
        const v = {
            nombre: S.limpiarEspacios(q('#reg-nombre').value), fn: q('#reg-fn').value, sexo: q('#reg-sexo').value,
            especialidad: q('#reg-especialidad').value, medico: q('#reg-medico').value, motivo: S.limpiarEspacios(q('#reg-motivo').value)
        };
        const errores = {};
        if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'.\- ]{5,}$/.test(v.nombre) || v.nombre.split(' ').filter(w => w.length > 1).length < 2) errores.nombre = 'Escriba nombre y apellido del paciente (solo letras).';
        const f = S.parseFechaISO(v.fn);
        if (!f) errores.fn = 'Seleccione la fecha de nacimiento.';
        else if (v.fn > S.hoyLocal()) errores.fn = 'La fecha no puede ser futura.';
        else if (v.fn < '1900-01-01') errores.fn = 'Fecha no válida.';
        if (!v.sexo) errores.sexo = 'Seleccione el sexo.';
        if (!v.especialidad) errores.especialidad = 'Seleccione la especialidad.';
        if (!v.medico) errores.medico = 'Seleccione el médico.';
        if (v.motivo.length < 3 || !/[A-Za-zÁÉÍÓÚáéíóúñÑ]{3}/.test(v.motivo)) errores.motivo = 'Describa el motivo de llegada.';

        c.el.querySelectorAll('[data-err]').forEach(p => p.classList.add('hidden'));
        c.el.querySelectorAll('input,select,textarea').forEach(i => i.classList.remove('border-red-500'));
        const claves = Object.keys(errores);
        if (claves.length) {
            claves.forEach(k => {
                const p = q(`[data-err="${k}"]`); if (p) { p.textContent = errores[k]; p.classList.remove('hidden'); }
                const inp = q('#reg-' + k); if (inp) inp.classList.add('border-red-500');
            });
            const primero = q('#reg-' + claves[0]); if (primero) primero.focus();
            return;
        }

        const esp = S.especialidadPorCodigo(v.especialidad), medico = S.USUARIOS[v.medico];
        const existente = c.coincidencia;
        const numero = S.posicionNuevaEnCola(v.medico);   // posición que tendrá en la fila inteligente
        const fila = (et, val) => `<div class="flex justify-between gap-4 py-1.5 border-b border-slate-100 last:border-0"><span class="text-slate-400 text-xs uppercase font-bold">${et}</span><span class="text-slate-800 font-semibold text-right">${val}</span></div>`;
        const edad = S.calcularEdad(v.fn);
        BelenUI.modal({
            titulo: 'Confirme los datos del paciente', subtitulo: 'Revise antes de registrar', tipo: 'info', icono: 'fa-clipboard-check', ancho: 'md',
            html: `<div class="text-sm text-left" id="reg-resumen">
                ${fila('Paciente', this.e(v.nombre))}
                ${fila('Expediente', existente ? `<span class="text-emerald-700">Existente · ${this.e(existente.paciente_id)}</span>` : '<span class="text-slate-600">Nuevo (se creará)</span>')}
                ${fila('Nacimiento', this.e(S.fechaLegibleISO(v.fn)) + (edad !== null ? ` (${edad} años)` : ''))}
                ${fila('Sexo', v.sexo === 'F' ? 'Femenino' : 'Masculino')}
                ${fila('Especialidad', this.e(esp.nombre))}
                ${fila('Médico', this.e(medico.nombre))}
                ${fila('Motivo', this.e(v.motivo))}
                <div class="mt-3 bg-slate-900 text-white rounded-lg px-4 py-3 flex items-center justify-between"><span class="text-xs uppercase text-slate-300 font-bold">Posición en la fila</span><span class="text-lg font-extrabold">${this.e(esp.nombre)} · Turno ${numero}</span></div></div>`,
            botones: [
                { texto: 'Regresar y editar', estilo: 'secundario' },
                { texto: 'Confirmar y Registrar', estilo: 'exito', id: 'reg-confirmar', alPulsar: () => {
                    const pac = existente || S.guardarPaciente({ nombre_completo: v.nombre, fecha_nacimiento: v.fn, sexo: v.sexo });
                    const turno = S.crearTurno({ paciente_id: pac.paciente_id, especialidad_codigo: v.especialidad, medico_id: v.medico, motivo: v.motivo, registrado_por: this.sesion.nombre });
                    if (!turno) { BelenUI.toast('No fue posible registrar al paciente.', 'peligro'); return false; }
                    c.cerrar();
                    if (esMedico) {
                        S.iniciarConsulta(turno.turno_id, this.sesion);
                        window.location.href = 'expediente.html?turno=' + encodeURIComponent(turno.turno_id);
                        return;
                    }
                    BelenUI.toast(`${turno.paciente_nombre} quedó en el Turno ${S.posicionEnCola(turno.turno_id) || 1} de ${turno.especialidad}.`, 'exito', 5000);
                    this.vista = this.vistaPermitida('fila') ? 'fila' : this.vista;
                    this.filtroEspecialidad = '';
                    history.replaceState(null, '', '?vista=' + this.vista);
                    this.render();
                } }
            ]
        });
    }
};

document.addEventListener('DOMContentLoaded', () => AdminController.init());
