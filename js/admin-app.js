// Archivo: js/admin-app.js
// ============================================================
// CONTROLADOR DEL DASHBOARD (vistas por rol y por médico)
// Vistas: central | fila | hospitalizacion | cirugias | expedientes | personal | farmacia   (?vista=...)
// Datos: BelenStore (js/belen-store.js). Interfaz: BelenUI (js/belen-ui.js).
// CERO alert()/prompt()/confirm() nativos: todo con modales Tailwind.
// ============================================================

const AdminController = {
    rolActual: null,
    sesion: null,
    vista: 'central',
    filtroEspecialidad: '',
    pestanaFarmacia: 'terminal',
    carritoFarmacia: [],
    pacienteCargoId: null,
    enfermeraCargoId: '',
    _temporizador: null,
    _pendienteRender: null,

    // roles: quién puede tener la vista. modulo: permiso de módulo (BelenStore.PERMISOS) que el administrador enciende/apaga por usuario.
    VISTAS: {
        central:         { roles: ['admin', 'administrador', 'medico'],                                           modulo: 'ver_consultas',      titulo: { admin: 'Dashboard Central', administrador: 'Dashboard Central', medico: 'Mi Consultorio' } },
        fila:            { roles: ['admin', 'administrador', 'enf_triage', 'enf_hospital', 'enf_quirofano'],      modulo: 'ver_consultas',      titulo: { admin: 'Fila de Espera' } },
        hospitalizacion: { roles: ['admin', 'administrador', 'enf_triage', 'enf_hospital', 'enf_quirofano', 'medico'], modulo: 'ver_hospitalizados', titulo: { admin: 'Monitor de Camas', administrador: 'Monitor de Camas', medico: 'Mis Pacientes Hospitalizados' } },
        cirugias:        { roles: ['admin', 'administrador', 'enf_triage', 'enf_hospital', 'enf_quirofano', 'medico'], modulo: 'ver_quirofano', titulo: { admin: 'Próximas Cirugías', medico: 'Mis cirugías' } },
        expedientes:     { roles: ['admin', 'medico'],                                                            modulo: 'ver_consultas',      titulo: { admin: 'Búsqueda Histórica', medico: 'Búsqueda Histórica' } },
        personal:        { roles: ['admin'],                                                                      modulo: 'gestionar_personal', titulo: { admin: 'Gestión de Personal' } },
        farmacia:        { roles: ['admin', 'administrador', 'enf_farmacia', 'enf_hospital', 'enf_quirofano'], modulo: 'ver_farmacia', titulo: { admin: 'Farmacia e Inventario' } }
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
            const rolOk = !roles || roles.split(',').includes(this.rolActual);
            const moduloOk = !modulo || BelenStore.puede(modulo);
            const concedido = modulo && BelenStore.permisoModuloExplicito(this.sesion.usuario_id, modulo) === true;
            el.style.display = (rolOk && moduloOk) || concedido ? '' : 'none';
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
        if (!d) return false;
        const concedido = d.modulo && BelenStore.permisoModuloExplicito(this.sesion.usuario_id, d.modulo) === true;
        if (!d.roles.includes(this.rolActual) && !concedido) return false;
        return !d.modulo || BelenStore.puede(d.modulo) || concedido;
    },
    // Primera vista disponible para el usuario (null si el administrador le apagó todos los módulos)
    vistaInicial: function () {
        return ['central', 'fila', 'hospitalizacion', 'cirugias', 'expedientes', 'personal', 'farmacia'].find(v => this.vistaPermitida(v)) || null;
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
        else if (this.vista === 'farmacia') { cont.innerHTML = this.htmlFarmacia(); this.enlazarTerminalFarmacia(); }
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
            alta: 'bg-slate-100 text-slate-500 border-slate-200',
            alta_medica_pendiente_pago: 'bg-amber-50 text-amber-800 border-amber-300',
            cerrado_historico: 'bg-slate-100 text-slate-500 border-slate-200'
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
        if (s.especialidad_codigo === 'ANESTESIOLOGIA') return this.htmlAnestesiologo();
        const enConsulta = S.pacientesEnConsulta(s);
        const espera = S.colaEspera(s);
        const hosp = S.hospitalizadosDe(s);
        const cirugias = S.cirugiasVisibles(s).slice(0, 4);

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
                <div class="bg-white/80 border border-slate-200 rounded-2xl p-4 flex items-center justify-between mb-8">
                    <p class="text-sm text-slate-600"><i class="fas fa-bed-pulse text-indigo-500 mr-2"></i> Pacientes hospitalizados a su cargo o en interconsulta: <b>${hosp.length}</b></p>
                    ${S.puede('ver_hospitalizados') ? `<a href="?vista=hospitalizacion" onclick="AdminController.navegar('hospitalizacion', event)" class="text-xs font-bold text-cyan-700 hover:text-cyan-900">Ver mis hospitalizados <i class="fas fa-arrow-right ml-1"></i></a>` : ''}</div>
                <div class="flex items-center justify-between mb-3">
                    <h3 class="text-sm font-bold text-violet-700 uppercase tracking-wider flex items-center gap-2"><i class="fas fa-kit-medical"></i> Mis próximas cirugías</h3>
                    ${S.puede('ver_quirofano') ? `<a href="?vista=cirugias" onclick="AdminController.navegar('cirugias', event)" class="text-xs font-bold text-cyan-700 hover:text-cyan-900">Ver mi agenda <i class="fas fa-arrow-right ml-1"></i></a>` : ''}</div>
                <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">${cirugias.length ? cirugias.map(c => this.htmlTarjetaCirugia(c)).join('') : '<p class="xl:col-span-2 text-sm text-slate-400 bg-white/60 border border-dashed border-slate-300 rounded-xl p-5 text-center">No tiene cirugías asignadas como cirujano ni como interconsultado.</p>'}</div>`;
    },

    htmlAnestesiologo: function () {
        const S = BelenStore, s = this.sesion;
        const cirugias = S.cirugiasVisibles(s);
        const espera = S.colaEspera(s);
        const hosp = S.hospitalizadosDe(s);
        return `<div class="flex flex-wrap justify-between items-end gap-4 mb-6">
                    <div><h2 class="text-2xl font-extrabold text-slate-800">Valoración anestésica</h2>
                        <p class="text-slate-500"><span class="font-semibold text-slate-700">${this.e(s.nombre)}</span> · Solo las cirugías y pacientes asignados a su valoración.</p></div>
                    ${S.puede('ver_quirofano') ? `<a href="?vista=cirugias" onclick="AdminController.navegar('cirugias', event)" class="text-xs font-bold text-cyan-700 hover:text-cyan-900">Abrir mi agenda <i class="fas fa-arrow-right ml-1"></i></a>` : ''}</div>
                <div class="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-8" id="anestesia-cirugias">${cirugias.length ? cirugias.map(c => this.htmlTarjetaCirugia(c)).join('') : '<p class="xl:col-span-2 text-sm text-slate-400 bg-white/60 border border-dashed border-slate-300 rounded-xl p-5 text-center">No tiene cirugías asignadas.</p>'}</div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="bg-white/80 border border-slate-200 rounded-2xl p-4"><p class="text-[10px] font-bold text-slate-400 uppercase">En valoración directa</p><p class="text-3xl font-extrabold text-slate-800 mt-1">${espera.length}</p><p class="text-xs text-slate-500 mt-1">Pacientes en su fila, no los de otros médicos.</p></div>
                    <div class="bg-white/80 border border-slate-200 rounded-2xl p-4"><p class="text-[10px] font-bold text-slate-400 uppercase">Hospitalizados asignados</p><p class="text-3xl font-extrabold text-indigo-700 mt-1">${hosp.length}</p><p class="text-xs text-slate-500 mt-1">A su cargo, en interconsulta o ligados a su cirugía.</p></div>
                </div>`;
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
        const hospTodos = S.puede('ver_hospitalizados') ? S.hospitalizadosDe(this.sesion) : [];
        const hosp = hospTodos.filter(t => t.estatus === 'internado' || t.estatus === 'internado_en_proceso');
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
            const proximas = verCirugias ? S.cirugiasVisibles(this.sesion).slice(0, 3) : [];
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
        const cuentas = S.puede('ver_cuentas_cobrar') ? this.htmlCuentasPorCobrar() : '';
        const restablecer = this.rolActual === 'admin' ? `
                <div class="mt-10 pt-4 border-t border-slate-200 flex items-center justify-between">
                    <p class="text-xs text-slate-400"><i class="fas fa-gear mr-1"></i> Configuración del demo</p>
                    <button type="button" id="btn-restablecer-demo" onclick="AdminController.confirmarRestablecerDemo()" class="text-xs font-bold text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-2 rounded-lg transition">Restablecer datos de demostración</button></div>` : '';
        return `${metricas}${cuentas}
                <div class="flex flex-wrap justify-between items-end gap-4 mb-6">
                    <div><h2 class="text-2xl font-extrabold text-slate-800">Operación del Día</h2><p class="text-slate-500">Resumen de filas por especialidad${hosp.length || S.puede('ver_hospitalizados') ? ' y pacientes hospitalizados' : ''}.</p></div>
                    ${registro}</div>
                <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">${tarjetasEsp}
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
            <div class="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-slate-100">
                ${dato('Fecha de nacimiento', `<span data-campo="nacimiento">${e(BelenStore.fechaLegibleISO(c.fecha_nacimiento))}</span>`)}
                ${dato('Edad', `<span data-campo="edad">${c.edad !== null ? c.edad + ' años' : '—'}</span>`)}
                ${dato('Médico cirujano', `<span class="font-semibold" data-campo="cirujano">${e(c.medico_cirujano)}</span>${c.medico_especialidad ? `<span class="block text-[11px] text-slate-400">${e(c.medico_especialidad)}</span>` : ''}`)}
                ${dato('Anestesiólogo', `<span class="font-semibold" data-campo="anestesiologo">${c.anestesiologo ? e(c.anestesiologo) : '<span class="text-slate-400">Sin asignar</span>'}</span>`)}
            </div>
            <div class="mt-3 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
                <p class="text-[10px] font-bold text-yellow-700 uppercase leading-none mb-1"><i class="fas fa-note-sticky mr-1"></i>Notas</p>
                <p class="text-xs text-slate-800" data-campo="notas">${c.notas ? e(c.notas) : '<span class="text-slate-400 italic">Sin notas registradas.</span>'}</p></div>
        </div>`;
    },

    htmlCirugias: function () {
        const S = BelenStore;
        const lista = S.cirugiasVisibles(this.sesion);
        const boton = S.puede('programar_cirugia')
            ? `<button type="button" id="btn-programar-cirugia" onclick="AdminController.abrirProgramarCirugia()" class="bg-violet-600 hover:bg-violet-700 text-white font-bold py-3 px-6 rounded-xl shadow-md hover:-translate-y-0.5 transition-all flex items-center gap-2"><i class="fas fa-plus-circle"></i> + Programar Cirugía</button>` : '';
        const aviso = this.sesion.especialidad_codigo === 'ANESTESIOLOGIA'
            ? 'Solo aparecen las cirugías en las que usted es la anestesióloga o el anestesiólogo asignado.'
            : (this.rolActual === 'medico'
                ? 'Solo aparecen las cirugías en las que usted es el cirujano o le solicitaron interconsulta.'
                : (this.rolActual === 'enf_quirofano'
                    ? 'Enfermería de Quirófano: consulte la agenda quirúrgica para preparar sala, material y paciente.'
                    : 'Agenda quirúrgica ordenada por fecha y hora exacta.'));
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
        const anests = S.anestesiologos().map(m => `<option value="${m.id}">${this.e(m.nombre)} · ${this.e(m.cargo)}</option>`).join('');
        BelenUI.modal({
            titulo: 'Programar Cirugía', subtitulo: 'Todos los datos se mostrarán en la tarjeta de la agenda quirúrgica.', icono: 'fa-kit-medical', ancho: 'lg',
            html: `<div class="grid grid-cols-1 sm:grid-cols-6 gap-4">
                <div class="sm:col-span-6">${lab('cx-nombre', 'Nombre completo del paciente', true)}<input id="cx-nombre" type="text" autocomplete="off" placeholder="Nombre y apellidos" class="${cls}" data-autofoco>${err('nombre')}</div>
                <div class="sm:col-span-3">${lab('cx-fecha_nacimiento', 'Fecha de nacimiento', true)}<input id="cx-fecha_nacimiento" type="date" min="1900-01-01" max="${S.hoyLocal()}" class="${cls}">${err('fecha_nacimiento')}</div>
                <div class="sm:col-span-3">${lab('cx-edad', 'Edad')}<input id="cx-edad" type="text" readonly tabindex="-1" placeholder="Se calcula sola" class="${cls} bg-slate-50 text-slate-500"></div>
                <div class="sm:col-span-6">${lab('cx-procedimiento', 'Nombre de la cirugía', true)}<input id="cx-procedimiento" type="text" maxlength="120" placeholder="Ej. Colecistectomía laparoscópica" class="${cls}">${err('procedimiento')}</div>
                <div class="sm:col-span-3">${lab('cx-fecha_hora', 'Fecha y hora exacta', true)}<input id="cx-fecha_hora" type="datetime-local" min="${minimo}" step="300" class="${cls}">${err('fecha_hora')}</div>
                <div class="sm:col-span-3">${lab('cx-medico_cirujano_id', 'Médico cirujano', true)}<select id="cx-medico_cirujano_id" class="${cls}"><option value="">Seleccione…</option>${medicos}</select>${err('medico_cirujano_id')}</div>
                <div class="sm:col-span-3">${lab('cx-anestesiologo_id', 'Anestesiólogo', true)}<select id="cx-anestesiologo_id" class="${cls}"><option value="">Seleccione…</option>${anests}</select>${err('anestesiologo_id')}</div>
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
                        fecha_hora: q('#cx-fecha_hora').value, medico_cirujano_id: q('#cx-medico_cirujano_id').value, anestesiologo_id: q('#cx-anestesiologo_id').value, notas: q('#cx-notas').value
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

    htmlCuentasPorCobrar: function () {
        const S = BelenStore, e = t => this.e(t);
        const filas = S.cuentasPorCobrar(this.sesion).map(t => S.fichaCuenta(t));
        const cuerpo = filas.length ? filas.map(f => {
            const origen = f.origen === 'hospitalizacion' ? 'Hospitalización' : 'Consulta ambulatoria';
            return `<button type="button" data-turno="${e(f.turno_id)}" onclick="AdminController.abrirDesgloseCuenta('${e(f.turno_id)}')"
                class="w-full text-left bg-white border border-amber-200 hover:border-amber-400 hover:shadow-md rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 transition">
                <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2"><h4 class="text-base font-extrabold text-slate-900">${e(f.nombre)}</h4>${this.badgeEstatus({ estatus: f.estatus })}</div>
                    <p class="text-xs text-slate-500 mt-0.5">${e(origen)}${f.cama ? ' · ' + e(f.cama) : ''} · ${e(f.medico_nombre)}</p>
                    ${f.diagnostico ? `<p class="text-xs text-slate-600 mt-1">${e(f.diagnostico)}</p>` : ''}
                </div>
                <div class="text-right shrink-0">
                    <p class="text-lg font-extrabold text-amber-800">${e(S.formatoMoneda(f.total))}</p>
                    <p class="text-[10px] font-bold uppercase text-amber-600">${f.cargos.length} ${f.cargos.length === 1 ? 'concepto' : 'conceptos'}</p>
                </div>
            </button>`;
        }).join('') : `<div class="text-center py-8 text-slate-400 bg-white/70 border border-dashed border-amber-200 rounded-xl">
            <i class="fas fa-circle-check text-2xl text-emerald-300 mb-2"></i>
            <p class="text-sm font-medium">No hay egresos pendientes de cobro.</p></div>`;
        return `<section class="mb-8 bg-amber-50/80 border border-amber-200 rounded-2xl p-5 shadow-sm">
            <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div>
                    <h3 class="text-lg font-extrabold text-amber-950 flex items-center gap-2"><i class="fas fa-cash-register text-amber-600"></i> Cuentas por Cobrar / Egresos Pendientes</h3>
                    <p class="text-xs text-amber-800 mt-0.5">Pacientes con alta médica que deben pagar en caja antes de cerrar el expediente.</p>
                </div>
                <span class="text-xs font-extrabold bg-amber-600 text-white rounded-full px-3 py-1">${filas.length}</span>
            </div>
            <div class="flex flex-col gap-2">${cuerpo}</div>
        </section>`;
    },

    abrirDesgloseCuenta: function (turnoId) {
        const S = BelenStore, t = S.obtenerTurno(turnoId);
        if (!t || !S.puede('ver_cuentas_cobrar')) { BelenUI.toast('No puede consultar esta cuenta.', 'alerta'); return; }
        if (t.estatus !== 'alta_medica_pendiente_pago') { BelenUI.toast('Esta cuenta ya no está pendiente de cobro.', 'info'); this.render(); return; }
        const f = S.fichaCuenta(t), e = x => this.e(x);
        const filas = f.cargos.length ? f.cargos.map((c, i) => `<tr class="border-t border-slate-100">
            <td class="px-3 py-2 text-slate-500">${i + 1}</td>
            <td class="px-3 py-2 font-medium text-slate-800">${e(c.concepto)}${c.lote ? `<span class="block text-[11px] text-slate-400">Lote ${e(c.lote)}</span>` : ''}</td>
            <td class="px-3 py-2 text-right">${e(S.formatoMoneda(c.precio_con_iva || c.precio_unitario))}${c.aplica_iva ? '<span class="block text-[10px] text-slate-400">IVA 16%</span>' : ''}</td>
            <td class="px-3 py-2 text-center">${c.cantidad || 1}</td>
            <td class="px-3 py-2 text-right font-bold">${e(S.formatoMoneda(c.subtotal))}</td>
            <td class="px-3 py-2 text-xs text-slate-600">${e(this.textoAtribucionCargo(c))}</td>
        </tr>`).join('') : '<tr><td colspan="6" class="px-3 py-6 text-center text-slate-400">Sin cargos registrados. El total a cobrar es $0.00.</td></tr>';
        const html = `<div class="space-y-3 text-left">
            <p class="text-xs text-slate-500">${f.origen === 'hospitalizacion' ? 'Egreso hospitalario' : 'Consulta ambulatoria'} · ${e(f.medico_nombre)}${f.diagnostico ? ' · ' + e(f.diagnostico) : ''}</p>
            <div class="border border-slate-200 rounded-xl overflow-x-auto">
                <table class="w-full text-sm">
                    <thead class="bg-slate-50 text-[11px] uppercase text-slate-400"><tr>
                        <th class="px-3 py-2 text-left">#</th><th class="px-3 py-2 text-left">Concepto</th>
                        <th class="px-3 py-2 text-right">Precio unitario</th><th class="px-3 py-2 text-center">Cantidad</th>
                        <th class="px-3 py-2 text-right">Subtotal</th>
                        <th class="px-3 py-2 text-left">Fecha/Hora y Enfermera que cargó</th></tr></thead>
                    <tbody>${filas}</tbody>
                    <tfoot><tr class="border-t-2 border-slate-200 bg-slate-50">
                        <td colspan="4" class="px-3 py-3 text-right text-xs font-bold uppercase text-slate-500">Total</td>
                        <td class="px-3 py-3 text-right text-base font-extrabold text-slate-900">${e(S.formatoMoneda(f.total))}</td>
                        <td></td>
                    </tr></tfoot>
                </table>
            </div>
            ${f.internamiento_id ? `<a href="expediente.html?modo=hospitalizado&turno=${encodeURIComponent(f.turno_id)}" class="inline-flex items-center gap-1.5 text-xs font-bold text-cyan-700 hover:text-cyan-900"><i class="fas fa-folder-tree"></i> Ver portafolio</a>` : ''}
        </div>`;
        BelenUI.modal({
            titulo: 'Desglose de cuenta', subtitulo: f.nombre, icono: 'fa-receipt', tipo: 'alerta', ancho: 'lg', html: html,
            botones: [
                { texto: 'Cerrar', estilo: 'secundario' },
                { texto: 'Marcar como Pagado y Cerrar Expediente', estilo: 'primario', id: 'caja-pagar', alPulsar: () => { setTimeout(() => this.confirmarCerrarExpediente(turnoId), 200); } }
            ]
        });
    },

    confirmarCerrarExpediente: function (turnoId) {
        const S = BelenStore, t = S.obtenerTurno(turnoId);
        if (!t) return;
        const f = S.fichaCuenta(t);
        BelenUI.confirmar({
            titulo: '¿Marcar como pagado y cerrar el expediente?', tipo: 'alerta', textoConfirmar: 'Sí, cobrar y cerrar',
            mensaje: 'Se registrará el pago de ' + S.formatoMoneda(f.total) + ' para ' + f.nombre + '. El paciente desaparecerá de los monitores activos y quedará solo en la búsqueda histórica.',
            alConfirmar: () => {
                const r = S.cerrarExpedientePagado(turnoId, this.sesion);
                if (!r.ok) { BelenUI.toast(r.motivo, 'peligro'); return false; }
                BelenUI.toast('Expediente cerrado. ' + f.nombre + ' pasó al archivo histórico.', 'exito');
                this.render();
            }
        });
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
            const pendientePago = !!f.pendiente_pago;
            const enProceso = !f.finalizado && !pendientePago;
            const alergia = f.alergias
                ? `<span data-alergias="1" class="inline-flex items-center gap-1.5 text-xs font-bold text-red-700 bg-red-50 border border-red-300 rounded-lg px-2.5 py-1"><i class="fas fa-triangle-exclamation"></i> ${e(f.alergias)}</span>`
                : `<span data-alergias="0" class="text-xs text-slate-400">Ninguna referida</span>`;
            const relacion = f.relacion === 'interconsultante'
                ? '<span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded border bg-indigo-50 text-indigo-700 border-indigo-200"><i class="fas fa-user-doctor mr-1"></i>Interconsulta Solicitada</span>' : '';
            let accion;
            if (f.finalizado || pendientePago) {
                accion = `<a href="expediente.html?modo=hospitalizado&turno=${encodeURIComponent(f.turno_id)}" data-accion="abrir-expediente" class="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold py-2.5 px-4 rounded-lg shadow-sm transition flex items-center gap-2"><i class="fas fa-folder-tree"></i> Ver Expediente</a>`;
                if (pendientePago && S.puede('ver_cuentas_cobrar')) {
                    accion += `<button type="button" onclick="AdminController.abrirDesgloseCuenta('${e(f.turno_id)}')" class="bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold py-2.5 px-4 rounded-lg shadow-sm transition flex items-center gap-2"><i class="fas fa-cash-register"></i> Cobrar</button>`;
                }
            } else if (f.relacion === 'interconsultante') {
                accion = `<span class="text-[11px] font-semibold text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">Papeleo de ingreso en curso</span>`;
            } else {
                const txt = esEnf ? 'Completar Hoja Frontal y Consentimientos' : 'Continuar Expediente';
                const ico = esEnf ? 'fa-clipboard-list' : 'fa-file-medical';
                const cls = esEnf ? 'bg-cyan-700 hover:bg-cyan-800 text-white' : 'bg-slate-900 hover:bg-slate-800 text-white';
                accion = `<a href="expediente.html?turno=${encodeURIComponent(f.turno_id)}" data-accion="abrir-expediente" class="${cls} text-xs font-bold py-2.5 px-4 rounded-lg shadow-sm transition flex items-center gap-2"><i class="fas ${ico}"></i> ${txt}</a>`;
            }
            const botonCama = (!pendientePago && S.puede('asignar_cama'))
                ? `<button type="button" data-accion="asignar-cama" onclick="AdminController.abrirAsignarCama('${e(f.turno_id)}')" class="bg-white border border-slate-300 hover:border-cyan-500 hover:text-cyan-700 text-slate-700 text-xs font-bold py-2 px-3 rounded-lg transition flex items-center gap-1.5"><i class="fas fa-bed"></i> ${f.cama ? 'Cambiar cama' : 'Asignar cama'}</button>` : '';
            const ics = f.interconsultas.length
                ? f.interconsultas.map(x => `<span class="inline-block bg-indigo-50 text-indigo-700 border border-indigo-200 rounded px-1.5 py-0.5 text-[10px] font-bold mr-1">${e(x.especialidad)} · ${e(x.medico_nombre)}</span>`).join('') : '';
            const borde = pendientePago ? 'border-l-amber-500' : (enProceso ? 'border-l-indigo-500' : 'border-l-slate-400');
            return `<div data-turno="${e(f.turno_id)}" data-paciente="${e(f.paciente_id)}" class="bg-white rounded-2xl border border-slate-200 border-l-4 ${borde} shadow-sm p-5">
                <div class="flex flex-wrap items-start gap-4">
                    <div class="min-w-[4rem] max-w-[7rem] min-h-[4rem] py-1 rounded-xl ${f.cama ? (pendientePago ? 'bg-amber-600 text-white' : 'bg-indigo-600 text-white') : 'bg-slate-100 text-slate-400 border border-dashed border-slate-300'} flex flex-col items-center justify-center shrink-0 text-center px-1">
                        <i class="fas fa-bed text-sm"></i><span data-cama="1" class="text-[11px] font-extrabold leading-tight mt-0.5 break-words">${f.cama ? e(f.cama) : 'Sin cama'}</span></div>
                    <div class="flex-1 min-w-[240px]">
                        <div class="flex flex-wrap items-center gap-2"><h4 class="text-lg font-bold text-slate-900">${e(f.nombre)}</h4>${this.badgeEstatus({ estatus: f.estatus })}${relacion}</div>
                        <p class="text-xs text-slate-500">${f.edad !== null ? f.edad + ' años' : ''}${sexoTxt(f) ? ' · ' + sexoTxt(f) : ''}${f.area ? ' · ' + e(f.area) : ''}${pendientePago ? ' · ' + e(S.formatoMoneda(f.cuenta_actual || 0)) : ''}</p>
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
    // VISTA: FARMACIA E INVENTARIO
    // ======================================================================
    cambiarPestanaFarmacia: function (pestana) {
        const ok = ['terminal', 'inventario', 'surtido', 'paquetes'];
        this.pestanaFarmacia = ok.indexOf(pestana) >= 0 ? pestana : 'terminal';
        this.render();
    },

    htmlFarmacia: function () {
        const S = BelenStore;
        const tab = (id, txt, n) => {
            const on = this.pestanaFarmacia === id;
            return `<button type="button" onclick="AdminController.cambiarPestanaFarmacia('${id}')" class="px-4 py-2 rounded-lg text-sm font-bold transition ${on ? 'bg-white text-teal-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}">${txt}${n ? `<span class="ml-2 inline-flex min-w-[1.25rem] justify-center rounded-full bg-teal-600 text-white text-[10px] px-1.5 py-0.5">${n}</span>` : ''}</button>`;
        };
        const pendientes = S.fichasSurtidoPendiente(this.sesion);
        const cuerpos = { terminal: () => this.htmlTerminalFarmacia(), inventario: () => this.htmlInventarioFarmacia(), surtido: () => this.htmlColaSurtido(pendientes), paquetes: () => this.htmlPaquetesFarmacia() };
        const cuerpo = (cuerpos[this.pestanaFarmacia] || cuerpos.terminal)();
        const ingreso = this.pestanaFarmacia === 'inventario' && S.puede('gestionar_farmacia')
            ? '<button type="button" onclick="AdminController.abrirIngresoFarmacia()" class="bg-teal-700 hover:bg-teal-800 text-white text-sm font-bold py-2.5 px-4 rounded-lg shadow-sm transition flex items-center gap-2"><i class="fas fa-plus"></i> Nuevo Ingreso de Insumo / Servicio</button>' : '';
        const nuevoPaq = this.pestanaFarmacia === 'paquetes' && S.puede('gestionar_farmacia')
            ? '<button type="button" onclick="AdminController.abrirEditorPaquete()" class="bg-teal-700 hover:bg-teal-800 text-white text-sm font-bold py-2.5 px-4 rounded-lg shadow-sm transition flex items-center gap-2"><i class="fas fa-plus"></i> Nuevo paquete</button>' : '';
        return `<div class="mb-6 flex flex-wrap items-end justify-between gap-3">
                    <div><h2 class="text-2xl font-extrabold text-slate-800">Farmacia e Inventario</h2>
                    <p class="text-slate-500">Terminal de cargo, almacén con IVA, paquetes quirúrgicos y control COFEPRIS.</p></div>
                    ${ingreso}${nuevoPaq}
                </div>
                <div class="inline-flex flex-wrap bg-slate-100 rounded-xl p-1 mb-5 gap-1">${tab('terminal', 'Cargar a Paciente')}${tab('inventario', 'Inventario')}${tab('surtido', 'Solicitudes de Piso', pendientes.length)}${tab('paquetes', 'Paquetes y Kits')}</div>
                ${cuerpo}`;
    },

    htmlInventarioFarmacia: function () {
        const S = BelenStore, e = t => this.e(t);
        const filas = S.listarInventarioFarmacia(this.sesion);
        const motivo = p => {
            const partes = [];
            if (p.stock < 5) partes.push('stock menor a 5');
            if (p.dias_caducidad !== null && p.dias_caducidad < 0) partes.push('caducado');
            else if (p.dias_caducidad !== null && p.dias_caducidad < 30) partes.push('caduca en ' + p.dias_caducidad + ' días');
            return partes.join(' · ');
        };
        const tr = p => `<tr class="border-t border-slate-100 ${p.alerta ? 'bg-red-50 text-red-900' : 'hover:bg-slate-50/80'}" ${p.alerta ? `title="${e(motivo(p))}"` : ''}>
            <td class="px-3 py-3 font-mono text-xs font-bold">${e(p.sku)}</td>
            <td class="px-3 py-3 font-semibold">${e(p.nombre)}</td>
            <td class="px-3 py-3">${e(p.laboratorio || '')}</td>
            <td class="px-3 py-3 text-xs">${e(S.nombreCategoriaFarmacia(p.categoria))}</td>
            <td class="px-3 py-3 text-xs">${e(S.nombreFraccionCofepris(p.fraccion_cofepris))}</td>
            <td class="px-3 py-3 font-mono text-xs">${e(p.lote)}</td>
            <td class="px-3 py-3">${e(S.fechaLegibleISO(p.caducidad))}${p.alerta && p.dias_caducidad !== null && p.dias_caducidad < 30 ? ' <i class="fas fa-triangle-exclamation text-red-600"></i>' : ''}</td>
            <td class="px-3 py-3 font-bold">${p.stock}${p.stock < 5 ? ' <i class="fas fa-triangle-exclamation text-red-600"></i>' : ''}</td>
            <td class="px-3 py-3">${e(S.formatoMoneda(p.precio_unitario))}</td>
            <td class="px-3 py-3">${p.aplica_iva ? '16%' : '0%'}</td>
            <td class="px-3 py-3 font-bold">${e(S.formatoMoneda(p.precio_con_iva))}</td></tr>`;
        return `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-x-auto">
            <table class="w-full text-sm text-left" id="tabla-farmacia">
                <thead class="bg-slate-50 text-[11px] uppercase text-slate-400"><tr>
                    <th class="px-3 py-3">SKU</th><th class="px-3 py-3">Nombre</th><th class="px-3 py-3">Laboratorio</th><th class="px-3 py-3">Categoría</th><th class="px-3 py-3">Fracción</th>
                    <th class="px-3 py-3">Lote</th><th class="px-3 py-3">Caducidad</th><th class="px-3 py-3">Stock</th><th class="px-3 py-3">Precio</th><th class="px-3 py-3">IVA</th><th class="px-3 py-3">Precio con IVA</th>
                </tr></thead>
                <tbody>${filas.length ? filas.map(tr).join('') : '<tr><td colspan="11" class="px-4 py-16 text-center text-slate-400">No hay insumos en el almacén.</td></tr>'}</tbody>
            </table></div>
            <p class="text-[11px] text-slate-400 mt-3">La fila roja avisa stock menor a 5 o caducidad en menos de 30 días. Enter en el código simula la pistola lectora.</p>`;
    },

    htmlColaSurtido: function (pendientes) {
        const e = t => this.e(t);
        if (!pendientes.length) {
            return '<div class="text-center py-16 text-slate-400 font-medium bg-white/60 rounded-2xl border border-dashed border-slate-300"><i class="fas fa-clipboard-check text-4xl mb-3 text-slate-300"></i><p>No hay solicitudes pendientes de surtir.</p></div>';
        }
        const puede = BelenStore.puede('gestionar_farmacia');
        return `<div class="flex flex-col gap-3" id="cola-surtido">${pendientes.map(f => `<article class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-wrap items-center gap-4">
            <div class="flex-1 min-w-[240px]">
                <p class="text-sm font-bold text-slate-900">Paciente: ${e(f.paciente)} - Cama: ${e(f.cama)} - Solicita: ${e(f.resumen)}</p>
                <p class="text-[11px] text-slate-400 mt-1 uppercase font-bold">${f.origen === 'consulta' ? 'Consulta ambulatoria' : 'Indicación de piso'}</p>
            </div>
            ${puede ? `<button type="button" onclick="AdminController.abrirSurtido('${e(f.solicitud_id)}')" class="bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold py-2.5 px-4 rounded-lg shadow-sm transition flex items-center gap-2"><i class="fas fa-barcode"></i> Surtir</button>` : ''}
        </article>`).join('')}</div>`;
    },

    abrirIngresoFarmacia: function () {
        if (!BelenStore.puede('gestionar_farmacia')) { BelenUI.toast('Su perfil no puede registrar inventario.', 'alerta'); return; }
        const S = BelenStore;
        const campo = (id, et, tipo, extra) => `<div>
            <label for="${id}" class="block text-[11px] font-bold text-slate-500 uppercase mb-1">${et}</label>
            <input id="${id}" type="${tipo}" ${extra || ''} autocomplete="off" class="w-full border border-slate-300 rounded-lg p-2.5 text-sm text-slate-800 focus:border-teal-600 focus:ring-1 focus:ring-teal-600 outline-none bg-white">
            <p id="err-${id}" class="text-[11px] text-red-600 mt-1 hidden"></p></div>`;
        const sel = (id, et, opciones) => `<div><label for="${id}" class="block text-[11px] font-bold text-slate-500 uppercase mb-1">${et}</label>
            <select id="${id}" class="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white">${opciones}</select>
            <p id="err-${id}" class="text-[11px] text-red-600 mt-1 hidden"></p></div>`;
        BelenUI.modal({
            titulo: 'Nuevo ingreso de insumo / servicio', subtitulo: 'Si el código ya existe, Enter completa el producto y salta a lote y caducidad.', icono: 'fa-barcode', ancho: 'xl',
            html: `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                ${campo('far-sku', 'Código de barras / SKU', 'text', 'data-autofoco maxlength="20" placeholder="Escanee o escriba y pulse Enter"')}
                ${campo('far-nombre', 'Nombre', 'text', 'maxlength="80"')}
                ${campo('far-laboratorio', 'Laboratorio', 'text', 'maxlength="40" placeholder="Ej. Pisa, Pfizer"')}
                ${sel('far-categoria', 'Categoría', S.CATEGORIAS_FARMACIA.map(c => `<option value="${c.codigo}">${c.nombre}</option>`).join(''))}
                ${sel('far-fraccion', 'Fracción COFEPRIS', S.FRACCIONES_COFEPRIS.map(f => `<option value="${f.codigo}" ${f.codigo === 'NA' ? 'selected' : ''}>${f.nombre}</option>`).join(''))}
                ${campo('far-piezas', 'Piezas por caja', 'number', 'min="1" step="1" value="1"')}
                ${campo('far-lote', 'Lote', 'text', 'maxlength="30"')}
                ${campo('far-caducidad', 'Caducidad', 'date', '')}
                ${campo('far-stock', 'Stock que ingresa', 'number', 'min="1" step="1"')}
                ${campo('far-precio', 'Precio unitario (sin IVA)', 'number', 'min="0.01" step="0.01"')}
            </div>
            <label class="mt-3 flex items-center gap-2 text-sm text-slate-700"><input id="far-iva" type="checkbox" class="rounded border-slate-300 text-teal-700"> Aplica IVA 16% (material, insumos y estudios). Los medicamentos quedan en 0%.</label>
            <p id="far-precio-iva" class="text-xs text-slate-500 mt-1"></p>`,
            alMostrar: c => {
                const q = id => c.el.querySelector('#' + id);
                const pintar = () => {
                    const precio = parseFloat(q('far-precio').value);
                    const aplica = q('far-iva').checked;
                    q('far-precio-iva').textContent = Number.isFinite(precio) ? 'Precio con IVA: ' + S.formatoMoneda(aplica ? Math.round(precio * 116) / 100 : precio) : '';
                };
                q('far-precio').addEventListener('input', pintar);
                q('far-iva').addEventListener('change', pintar);
                const orden = ['far-sku', 'far-nombre', 'far-laboratorio', 'far-lote', 'far-caducidad', 'far-piezas', 'far-stock', 'far-precio'];
                orden.forEach((id, i) => {
                    q(id).addEventListener('keydown', ev => {
                        if (ev.key !== 'Enter') return;
                        ev.preventDefault();
                        if (id === 'far-sku') {
                            const prod = S.productoPorSku(ev.target.value);
                            if (prod) {
                                q('far-nombre').value = prod.nombre;
                                q('far-laboratorio').value = prod.laboratorio || '';
                                q('far-categoria').value = prod.categoria || 'MEDICAMENTO';
                                q('far-fraccion').value = prod.fraccion_cofepris || 'NA';
                                q('far-piezas').value = prod.piezas_por_caja || 1;
                                q('far-iva').checked = !!prod.aplica_iva;
                                q('far-precio').value = prod.precio_unitario;
                                pintar();
                                BelenUI.toast(prod.nombre + ' ya está en el catálogo. Capture lote y caducidad.', 'info');
                                q('far-lote').focus();
                                return;
                            }
                        }
                        if (i < orden.length - 1) q(orden[i + 1]).focus();
                        else q('far-guardar').click();
                    });
                });
            },
            botones: [
                { texto: 'Cancelar', estilo: 'secundario' },
                { texto: 'Registrar ingreso', estilo: 'exito', id: 'far-guardar', alPulsar: c => {
                    const val = id => c.el.querySelector('#' + id).value;
                    const r = S.ingresarInsumo({
                        sku: val('far-sku'), nombre: val('far-nombre'), laboratorio: val('far-laboratorio'), categoria: val('far-categoria'),
                        fraccion_cofepris: val('far-fraccion'), piezas_por_caja: val('far-piezas'), lote: val('far-lote'), caducidad: val('far-caducidad'),
                        stock: val('far-stock'), precio_unitario: val('far-precio'), aplica_iva: c.el.querySelector('#far-iva').checked
                    }, this.sesion);
                    const mapa = { 'far-sku': 'sku', 'far-nombre': 'nombre', 'far-laboratorio': 'laboratorio', 'far-categoria': 'categoria', 'far-fraccion': 'fraccion_cofepris', 'far-piezas': 'piezas_por_caja', 'far-lote': 'lote', 'far-caducidad': 'caducidad', 'far-stock': 'stock', 'far-precio': 'precio_unitario' };
                    Object.keys(mapa).forEach(id => {
                        const input = c.el.querySelector('#' + id), msg = c.el.querySelector('#err-' + id);
                        const error = r.errores && r.errores[mapa[id]];
                        if (input) input.classList.toggle('border-red-500', !!error);
                        if (msg) { msg.textContent = error || ''; msg.classList.toggle('hidden', !error); }
                    });
                    if (!r.ok) { if (!r.errores) BelenUI.toast(r.motivo, 'alerta'); return false; }
                    BelenUI.toast(r.producto.nombre + ' ingresado. Stock ' + r.producto.stock + '. Precio con IVA ' + S.formatoMoneda(r.producto.precio_con_iva) + '.', 'exito');
                    this.render();
                } }
            ]
        });
    },

    abrirSurtido: function (solicitudId) {
        const ficha = BelenStore.fichasSurtidoPendiente(this.sesion).find(x => x.solicitud_id === solicitudId);
        if (!ficha || !BelenStore.puede('gestionar_farmacia')) { BelenUI.toast('Esa solicitud ya no está pendiente.', 'alerta'); return; }
        BelenUI.modal({
            titulo: 'Surtir solicitud', subtitulo: 'Paciente: ' + ficha.paciente + ' - Cama: ' + ficha.cama, icono: 'fa-barcode', ancho: 'lg',
            html: this.htmlCuerpoEscaneo(ficha),
            alMostrar: c => this.enlazarEscaneo(c, solicitudId),
            botones: [{ texto: 'Cerrar', estilo: 'secundario' }]
        });
    },

    htmlCuerpoEscaneo: function (ficha) {
        const e = t => this.e(t);
        const vivas = ficha.lineas.filter(l => l.pendiente > 0);
        const botones = vivas.filter(l => l.sku_sugerido).map(l =>
            `<button type="button" data-sku="${e(l.sku_sugerido)}" class="px-3 py-2 rounded-lg bg-teal-50 border border-teal-200 text-teal-800 text-xs font-bold hover:bg-teal-100 text-left">${e(l.sku_sugerido)} · ${e(l.pendiente)}x ${e(l.nombre)}</button>`).join('');
        const opciones = vivas.filter(l => l.sku_sugerido).map(l => `<option value="${e(l.sku_sugerido)}">${e(l.sku_sugerido)} · ${e(l.nombre)}</option>`).join('');
        const avance = ficha.lineas.map(l => `<li class="flex justify-between gap-3 py-1"><span>${e(l.nombre)}</span><span class="font-bold ${l.pendiente ? 'text-amber-700' : 'text-emerald-700'}">${l.cantidad_surtida || 0}/${l.cantidad}</span></li>`).join('');
        return `<p class="text-sm font-bold text-slate-800 mb-3">Solicita: ${e(ficha.resumen)}</p>
            <label for="scan-codigo" class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Escanear código de barras</label>
            <input id="scan-codigo" data-autofoco autocomplete="off" placeholder="El cursor queda aquí para la pistola" class="w-full border border-teal-400 rounded-lg p-3 text-sm font-mono text-slate-800 focus:ring-2 focus:ring-teal-500 outline-none bg-white">
            <div class="flex flex-wrap gap-2 mt-3">${botones || '<p class="text-xs text-slate-400">Ningún código del inventario coincide con lo pedido.</p>'}</div>
            ${opciones ? `<label class="block text-[11px] font-bold text-slate-500 uppercase mt-3 mb-1">Simular escaneo</label>
            <select id="scan-lista" class="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white"><option value="">Elegir código…</option>${opciones}</select>` : ''}
            <ul class="mt-4 border-t border-slate-100 pt-2 text-sm text-slate-600">${avance}</ul>`;
    },

    enlazarEscaneo: function (ctrl, solicitudId) {
        const input = ctrl.el.querySelector('#scan-codigo');
        const correr = () => this.confirmarEscaneo(ctrl, solicitudId);
        input.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); correr(); } });
        ctrl.el.querySelectorAll('[data-sku]').forEach(b => b.addEventListener('click', () => { input.value = b.getAttribute('data-sku'); correr(); }));
        const lista = ctrl.el.querySelector('#scan-lista');
        if (lista) lista.addEventListener('change', () => { if (!lista.value) return; input.value = lista.value; correr(); });
        setTimeout(() => input.focus(), 30);
    },

    confirmarEscaneo: function (ctrl, solicitudId, opciones) {
        const input = ctrl.el.querySelector('#scan-codigo');
        const op = opciones || {};
        const r = BelenStore.surtirLinea(solicitudId, op.codigo || (input ? input.value : ''), this.sesion, op);
        if (r.fefo) { this.avisarFefo(r, elegido => this.confirmarEscaneo(ctrl, solicitudId, elegido)); return; }
        if (!r.ok) {
            BelenUI.toast(r.motivo, 'alerta');
            const lista = ctrl.el.querySelector('#scan-lista');
            if (lista) lista.value = '';
            if (input) { input.focus(); input.select(); }
            return;
        }
        BelenUI.toast(r.completa ? 'Solicitud surtida. El costo ya está en la cuenta.' : r.producto.nombre + ' surtido. Quedan ' + r.producto.stock + ' en almacén.', r.completa ? 'exito' : 'info');
        this.pestanaFarmacia = 'surtido';
        this.render();
        if (r.completa || ctrl.cerrado) { if (!ctrl.cerrado) ctrl.cerrar(); return; }
        const ficha = BelenStore.fichasSurtidoPendiente(this.sesion).find(x => x.solicitud_id === solicitudId);
        if (!ficha) { ctrl.cerrar(); return; }
        ctrl.cuerpo.innerHTML = this.htmlCuerpoEscaneo(ficha);
        this.enlazarEscaneo(ctrl, solicitudId);
    },

    avisarFefo: function (r, alElegir) {
        const fecha = BelenStore.fechaLegibleISO(r.alterno.caducidad);
        const texto = '¡Atención! Existe un lote con caducidad más próxima: Lote ' + r.alterno.lote + ' (Caduca: ' + fecha + ', Stock: ' + r.alterno.stock + '). Se recomienda utilizar primero ese lote para evitar mermas.';
        BelenUI.modal({
            titulo: 'Aviso FEFO', mensaje: texto, tipo: 'alerta', icono: 'fa-clock', ancho: 'md',
            botones: [
                { texto: 'Continuar con el lote actual de todos modos', estilo: 'secundario', alPulsar: () => alElegir({ codigo: r.lote.lote, lote_id: r.lote.lote_id, ignorar_fefo: true }) },
                { texto: 'Cambiar al Lote más próximo (Recomendado)', estilo: 'primario', alPulsar: () => alElegir({ codigo: r.alterno.lote, lote_id: r.alterno.lote_id, ignorar_fefo: true }) }
            ]
        });
    },

    pacienteCargoActual: function () {
        const grupos = BelenStore.pacientesTerminalFarmacia(this.sesion);
        return ['hospital', 'observacion', 'quirofano', 'consulta'].reduce((hallado, k) => hallado || grupos[k].find(p => p.turno_id === this.pacienteCargoId) || null, null);
    },

    htmlTerminalFarmacia: function () {
        const S = BelenStore, e = t => this.e(t);
        const grupos = S.pacientesTerminalFarmacia(this.sesion);
        const etiquetas = [['hospital', 'Hospitalizados'], ['observacion', 'En Observación'], ['quirofano', 'En Quirófano / Recuperación'], ['consulta', 'En Consulta Actual']];
        const elegido = this.pacienteCargoActual();
        const bloques = etiquetas.map(([k, titulo]) => {
            const lista = grupos[k];
            const botones = lista.length ? lista.map(p => `<button type="button" onclick="AdminController.elegirPacienteCargo('${e(p.turno_id)}')" class="w-full text-left px-3 py-2 rounded-lg border ${p.turno_id === this.pacienteCargoId ? 'border-teal-500 bg-teal-50' : 'border-slate-200 bg-white hover:bg-slate-50'}">
                <span class="block text-sm font-bold text-slate-800">${e(p.nombre)}</span>
                <span class="block text-[11px] text-slate-500">${e(p.cama)}${p.medico ? ' · ' + e(p.medico) : ''}</span></button>`).join('') : '<p class="text-xs text-slate-400 px-1">Nadie en esta área.</p>';
            return `<section class="mb-4"><h3 class="text-[11px] font-extrabold uppercase tracking-wide text-slate-400 mb-2">${titulo}</h3><div class="flex flex-col gap-2">${botones}</div></section>`;
        }).join('');
        const enfermeras = S.enfermerasActivas();
        const opcionesEnf = '<option value="">Seleccione…</option>' + enfermeras.map(u => `<option value="${e(u.id)}" ${u.id === this.enfermeraCargoId ? 'selected' : ''}>${e(u.nombre)}</option>`).join('');
        const banner = elegido
            ? `<div class="rounded-xl border border-teal-300 bg-teal-50 px-4 py-3 mb-4"><p class="text-[11px] font-bold uppercase text-teal-700">Paciente confirmado</p><p class="text-base font-extrabold text-teal-950">${e(elegido.nombre)}</p><p class="text-sm text-teal-800">${e(elegido.cama)}</p></div>`
            : '<div class="rounded-xl border border-dashed border-slate-300 px-4 py-3 mb-4 text-sm text-slate-500">Seleccione al paciente antes de escanear.</div>';
        return `<div class="grid grid-cols-1 lg:grid-cols-5 gap-5">
            <aside class="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm p-4 max-h-[70vh] overflow-y-auto">${bloques}</aside>
            <section class="lg:col-span-3 bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
                ${banner}
                <label for="terminal-enfermera" class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Enfermera / Personal que retira y carga</label>
                <select id="terminal-enfermera" onchange="AdminController.enfermeraCargoId=this.value" class="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white mb-4">${opcionesEnf}</select>
                <label for="terminal-scan" class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Pistola lectora</label>
                <input id="terminal-scan" data-terminal-scan autocomplete="off" placeholder="Escanee el código y pulse Enter" class="w-full border border-teal-400 rounded-lg p-3 text-sm font-mono focus:ring-2 focus:ring-teal-500 outline-none mb-3">
                <label for="terminal-buscar" class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Buscar manualmente</label>
                <input id="terminal-buscar" autocomplete="off" placeholder="Nombre, SKU o lote" oninput="AdminController.pintarBusquedaFarmacia(this.value)" class="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none mb-2">
                <div id="terminal-busqueda" class="flex flex-col gap-1 mb-3"></div>
                <div class="flex flex-wrap gap-2 mb-4">
                    <button type="button" onclick="AdminController.abrirAplicarPaquete()" class="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-3 py-2 rounded-lg"><i class="fas fa-kit-medical mr-1"></i> Aplicar Paquete Completo</button>
                </div>
                ${this.htmlCarritoFarmacia()}
            </section>
        </div>`;
    },

    enlazarTerminalFarmacia: function () {
        const scan = document.getElementById('terminal-scan');
        if (!scan) return;
        scan.addEventListener('keydown', ev => {
            if (ev.key !== 'Enter') return;
            ev.preventDefault();
            const codigo = scan.value.trim();
            scan.value = '';
            if (codigo) this.recibirEnCarrito(codigo);
        });
        scan.focus();
    },

    elegirPacienteCargo: function (turnoId) {
        this.pacienteCargoId = turnoId;
        this.render();
    },

    pintarBusquedaFarmacia: function (texto) {
        const caja = document.getElementById('terminal-busqueda');
        if (!caja) return;
        const e = t => this.e(t);
        const lotes = BelenStore.buscarLotesFarmacia(texto);
        caja.innerHTML = lotes.map(p => `<button type="button" onclick="AdminController.agregarLoteAlCarrito('${e(p.lote_id)}')" class="text-left px-3 py-2 rounded-lg border border-slate-200 hover:bg-teal-50 text-xs">
            <span class="font-bold">${e(p.nombre)}</span> · ${e(p.sku)} · Lote ${e(p.lote)} · caduca ${e(BelenStore.fechaLegibleISO(p.caducidad))} · stock ${p.stock}</button>`).join('');
    },

    htmlCarritoFarmacia: function () {
        const S = BelenStore, e = t => this.e(t);
        const inv = S.listarInventarioFarmacia(this.sesion);
        let base = 0, iva = 0, total = 0;
        const filas = this.carritoFarmacia.map(lin => {
            const p = inv.find(x => x.lote_id === lin.lote_id);
            if (!p) return `<tr><td colspan="4" class="px-3 py-2 text-red-600">Un lote del carrito ya no está disponible.</td></tr>`;
            const cant = lin.cantidad || 1;
            const unit = p.precio_con_iva;
            const sub = Math.round(unit * cant * 100) / 100;
            base += p.precio_unitario * cant;
            iva += (p.precio_con_iva - p.precio_unitario) * cant;
            total += sub;
            const aviso = S.etiquetaNormativa(p.fraccion_cofepris);
            const receta = ['II', 'III', 'IV_ANTIBIOTICO'].indexOf(p.fraccion_cofepris) >= 0
                ? `<button type="button" onclick="AdminController.imprimirRecetaLinea('${e(lin.linea_id)}')" class="mt-1 text-[11px] font-bold text-rose-700 underline">Generar e Imprimir Receta de Respaldo</button>` : '';
            const frac = p.fraccion_cofepris === 'I' && lin.receta_previa ? `<p class="text-[11px] text-amber-800">Receta individual ${e(lin.receta_previa)} · caja ${e(lin.folio_receta_especial || '')}</p>` : '';
            return `<tr class="border-t border-slate-100 align-top">
                <td class="px-3 py-2"><p class="font-semibold text-slate-800">${e(p.nombre)}</p><p class="text-[11px] text-slate-400">Lote ${e(p.lote)}${lin.paquete_nombre ? ' · ' + e(lin.paquete_nombre) : ''}</p>
                    ${aviso ? `<p class="text-[11px] font-bold text-rose-700 mt-1">${e(aviso)}</p>${receta}` : ''}${frac}</td>
                <td class="px-3 py-2 text-center">${cant}</td>
                <td class="px-3 py-2 text-right">${e(S.formatoMoneda(sub))}</td>
                <td class="px-3 py-2 text-right"><button type="button" onclick="AdminController.quitarLineaCarrito('${e(lin.linea_id)}')" class="text-slate-400 hover:text-red-600" aria-label="Quitar"><i class="fas fa-xmark"></i></button></td>
            </tr>`;
        }).join('');
        const vacio = this.carritoFarmacia.length ? '' : '<tr><td colspan="4" class="px-3 py-8 text-center text-slate-400">El carrito está vacío.</td></tr>';
        return `<table class="w-full text-sm"><thead class="text-[11px] uppercase text-slate-400"><tr><th class="px-3 py-2 text-left">Concepto</th><th class="px-3 py-2">Cant.</th><th class="px-3 py-2 text-right">Importe</th><th></th></tr></thead>
            <tbody>${filas || vacio}</tbody></table>
            <div class="mt-3 border-t border-slate-100 pt-3 text-sm space-y-1">
                <p class="flex justify-between text-slate-500"><span>Subtotal</span><span>${e(S.formatoMoneda(Math.round(base * 100) / 100))}</span></p>
                <p class="flex justify-between text-slate-500"><span>IVA</span><span>${e(S.formatoMoneda(Math.round(iva * 100) / 100))}</span></p>
                <p class="flex justify-between font-extrabold text-slate-900 text-base"><span>Total</span><span>${e(S.formatoMoneda(Math.round(total * 100) / 100))}</span></p>
            </div>
            <button type="button" onclick="AdminController.confirmarCargoPaciente()" class="mt-4 w-full bg-teal-700 hover:bg-teal-800 text-white font-bold py-3 rounded-xl">Confirmar y Cargar a Cuenta</button>`;
    },

    quitarLineaCarrito: function (lineaId) {
        this.carritoFarmacia = this.carritoFarmacia.filter(l => l.linea_id !== lineaId);
        this.render();
    },

    agregarLoteAlCarrito: function (loteId) {
        this.recibirEnCarrito(null, { lote_id: loteId });
    },

    recibirEnCarrito: function (codigo, opciones) {
        const op = opciones || {};
        const r = BelenStore.prepararLineaCarrito(codigo, op);
        if (r.fefo) {
            this.avisarFefo(r, elegido => this.recibirEnCarrito(elegido.codigo, { lote_id: elegido.lote_id, ignorar_fefo: true, cantidad: op.cantidad, paquete_id: op.paquete_id, paquete_nombre: op.paquete_nombre, servicio: op.servicio }));
            return;
        }
        if (!r.ok) { BelenUI.toast(r.motivo, 'alerta'); return; }
        if (r.producto.fraccion_cofepris === 'I' && !op.caja_id) { this.abrirUsoEstupefaciente(r.producto, op); return; }
        const cant = parseInt(op.cantidad, 10) || 1;
        const ya = this.carritoFarmacia.filter(l => l.lote_id === r.producto.lote_id).reduce((s, l) => s + (l.cantidad || 1), 0);
        if (!op.servicio && r.producto.stock < ya + cant) { BelenUI.toast('No hay stock suficiente de ' + r.producto.nombre + '.', 'alerta'); return; }
        if (r.producto.fraccion_cofepris !== 'I') {
            const misma = this.carritoFarmacia.find(l => l.lote_id === r.producto.lote_id && !l.caja_id && l.paquete_id === (op.paquete_id || null));
            if (misma) { misma.cantidad += cant; this.render(); return; }
        }
        this.carritoFarmacia.push({
            linea_id: 'LIN-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
            lote_id: r.producto.lote_id, cantidad: cant, ignorar_fefo: !!op.ignorar_fefo || !!op.lote_id,
            paquete_id: op.paquete_id || null, paquete_nombre: op.paquete_nombre || null, servicio: !!op.servicio,
            caja_id: op.caja_id || null, datos_postanestesicos: op.datos_postanestesicos || '',
            receta_previa: op.receta_previa || '', folio_receta_especial: op.folio_receta_especial || ''
        });
        this.render();
    },

    abrirUsoEstupefaciente: function (producto, opciones) {
        const S = BelenStore, e = t => this.e(t);
        const cajas = S.cajasAbiertasDe(producto.sku);
        const medicos = Object.values(S.USUARIOS).filter(u => u.activo !== false && u.rol === 'medico');
        const opcionesCaja = cajas.map(c => `<option value="${e(c.caja_id)}">${e(c.folio_receta_especial)} · ${c.usadas}/${c.piezas_por_caja} ámpulas · lote ${e(c.lote)}</option>`).join('');
        BelenUI.modal({
            titulo: 'Fracción I · ' + producto.nombre, subtitulo: 'Una ámpula, una receta individual ligada a la caja.', icono: 'fa-prescription', ancho: 'lg', tipo: 'alerta',
            html: `<div class="space-y-3 text-left">
                <p class="text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">${e(S.etiquetaNormativa('I'))}</p>
                <label class="block text-[11px] font-bold text-slate-500 uppercase">Caja abierta</label>
                <select id="fen-caja" class="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white"><option value="">Abrir una caja nueva…</option>${opcionesCaja}</select>
                <div id="fen-nueva" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div><label class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Folio de receta especial</label><input id="fen-folio" class="w-full border border-slate-300 rounded-lg p-2.5 text-sm" placeholder="RE-2026-0001"></div>
                    <div><label class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Responsable sanitario</label>
                        <select id="fen-responsable" class="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white">${medicos.map(m => `<option value="${e(m.id)}">${e(m.nombre)}</option>`).join('')}</select></div>
                </div>
                <label class="block text-[11px] font-bold text-slate-500 uppercase">Datos post-anestésicos</label>
                <textarea id="fen-datos" rows="3" class="w-full border border-slate-300 rounded-lg p-2.5 text-sm" placeholder="Procedimiento, dosis aplicada y hora"></textarea>
                <p id="fen-error" class="text-xs text-red-600 hidden"></p>
            </div>`,
            alMostrar: c => {
                const caja = c.el.querySelector('#fen-caja'), nueva = c.el.querySelector('#fen-nueva');
                const sync = () => { nueva.classList.toggle('hidden', !!caja.value); };
                caja.addEventListener('change', sync);
                sync();
            },
            botones: [
                { texto: 'Cancelar', estilo: 'secundario' },
                { texto: 'Agregar ámpula al carrito', estilo: 'primario', alPulsar: c => {
                    const error = c.el.querySelector('#fen-error');
                    const datos = c.el.querySelector('#fen-datos').value;
                    if (datos.trim().length < 8) { error.textContent = 'Registre los datos post-anestésicos de la ámpula.'; error.classList.remove('hidden'); return false; }
                    let cajaId = c.el.querySelector('#fen-caja').value;
                    if (!cajaId) {
                        const abierta = S.abrirCajaEstupefaciente({ lote_id: producto.lote_id, folio_receta_especial: c.el.querySelector('#fen-folio').value, responsable_id: c.el.querySelector('#fen-responsable').value }, this.sesion);
                        if (!abierta.ok) { error.textContent = abierta.motivo; error.classList.remove('hidden'); return false; }
                        cajaId = abierta.caja.caja_id;
                    }
                    const ficha = S.cajasAbiertasDe(producto.sku).find(x => x.caja_id === cajaId);
                    if (!ficha) { error.textContent = 'Esa caja ya no tiene ámpulas disponibles.'; error.classList.remove('hidden'); return false; }
                    this.recibirEnCarrito(producto.lote, { lote_id: producto.lote_id, ignorar_fefo: true, cantidad: 1, caja_id: cajaId, datos_postanestesicos: datos, receta_previa: (ficha.usadas + 1) + '/' + ficha.piezas_por_caja, folio_receta_especial: ficha.folio_receta_especial });
                } }
            ]
        });
    },

    abrirAplicarPaquete: function () {
        const S = BelenStore, e = t => this.e(t);
        const paquetes = S.listarPaquetes();
        if (!paquetes.length) { BelenUI.toast('No hay paquetes guardados.', 'info'); return; }
        BelenUI.modal({
            titulo: 'Aplicar paquete completo', subtitulo: 'El desglose entra al carrito. Puede seguir agregando estudios sueltos.', icono: 'fa-kit-medical', ancho: 'md',
            html: `<div class="flex flex-col gap-2">${paquetes.map(p => `<button type="button" data-paq="${e(p.paquete_id)}" class="text-left px-3 py-3 rounded-xl border border-slate-200 hover:bg-teal-50"><span class="font-bold text-slate-800">${e(p.nombre)}</span><span class="block text-xs text-slate-500">${p.items.length} ítems</span></button>`).join('')}</div>`,
            alMostrar: c => c.el.querySelectorAll('[data-paq]').forEach(b => b.addEventListener('click', () => { this.meterPaqueteEnCarrito(b.getAttribute('data-paq')); c.cerrar(); })),
            botones: [{ texto: 'Cerrar', estilo: 'secundario' }]
        });
    },

    meterPaqueteEnCarrito: function (paqueteId) {
        const r = BelenStore.lineasDePaquete(paqueteId);
        if (!r.ok) { BelenUI.toast(r.motivo, 'alerta'); return; }
        r.lineas.forEach(lin => this.recibirEnCarrito(null, lin));
        BelenUI.toast(r.paquete.nombre + ' quedó en el carrito. Puede agregar EKG, Dextrostix u otros estudios.', 'info');
        this.pestanaFarmacia = 'terminal';
        this.render();
    },

    confirmarCargoPaciente: function () {
        const S = BelenStore;
        const paciente = this.pacienteCargoActual();
        if (!paciente) { BelenUI.toast('Seleccione al paciente activo.', 'alerta'); return; }
        if (!this.enfermeraCargoId) { BelenUI.toast('Seleccione a la enfermera que retira y carga.', 'alerta'); return; }
        if (!this.carritoFarmacia.length) { BelenUI.toast('El carrito está vacío.', 'alerta'); return; }
        const enf = S.USUARIOS[this.enfermeraCargoId];
        const total = this.totalCarritoVisible();
        BelenUI.confirmar({
            titulo: 'Confirmar y cargar a cuenta',
            mensaje: 'Se cargará a ' + paciente.nombre + ' (' + paciente.cama + '). Retira: ' + (enf ? enf.nombre : '') + '. Total ' + S.formatoMoneda(total) + '.',
            textoConfirmar: 'Confirmar y Cargar a Cuenta',
            alConfirmar: () => this.ejecutarCargoPaciente()
        });
    },

    totalCarritoVisible: function () {
        const inv = BelenStore.listarInventarioFarmacia(this.sesion);
        return Math.round(this.carritoFarmacia.reduce((s, lin) => {
            const p = inv.find(x => x.lote_id === lin.lote_id);
            return s + (p ? p.precio_con_iva * (lin.cantidad || 1) : 0);
        }, 0) * 100) / 100;
    },

    ejecutarCargoPaciente: function () {
        const r = BelenStore.confirmarCarritoFarmacia({
            turno_id: this.pacienteCargoId,
            enfermera_id: this.enfermeraCargoId,
            lineas: this.carritoFarmacia
        }, this.sesion);
        if (r.fefo) { this.avisarFefo(r, elegido => { const lin = this.carritoFarmacia.find(l => l.lote_id === r.lote.lote_id); if (lin) { lin.lote_id = elegido.lote_id; lin.ignorar_fefo = true; } this.ejecutarCargoPaciente(); }); return; }
        if (!r.ok) { BelenUI.toast(r.motivo, 'alerta'); return; }
        this.carritoFarmacia = [];
        BelenUI.toast('Cargo aplicado a la cuenta. Total del episodio ' + BelenStore.formatoMoneda(r.total) + '.', 'exito');
        (r.recetas || []).forEach(rec => this.imprimirRecetaDatos(this.datosRecetaDe({
            nombre: rec.nombre, lote: rec.lote, laboratorio: '', fraccion_cofepris: 'I', sku: rec.sku
        }, { tipo: 'individual', numero: rec.numero, de: rec.de, folio_receta_especial: rec.folio_receta_especial, datos_postanestesicos: rec.datos_postanestesicos, dosis: rec.datos_postanestesicos })));
        this.render();
    },

    datosRecetaDe: function (producto, extra) {
        const S = BelenStore;
        const paciente = this.pacienteCargoActual();
        const turno = paciente ? S.obtenerTurno(paciente.turno_id) : null;
        const medico = turno && S.USUARIOS[turno.medico_id];
        return S.datosReceta(Object.assign({
            producto: producto, paciente: paciente ? paciente.nombre : '', cama: paciente ? paciente.cama : '',
            medico: medico ? medico.nombre : (turno && turno.medico_nombre) || '', cedula: medico ? medico.cedula_profesional : '',
            denominacion: producto.nombre, dosis: extra && extra.dosis || producto.nombre, lote: producto.lote, laboratorio: producto.laboratorio,
            fraccion: producto.fraccion_cofepris
        }, extra || {}));
    },

    imprimirRecetaLinea: function (lineaId) {
        const lin = this.carritoFarmacia.find(l => l.linea_id === lineaId);
        const p = lin && BelenStore.listarInventarioFarmacia(this.sesion).find(x => x.lote_id === lin.lote_id);
        if (!p) { BelenUI.toast('Esa línea ya no está en el carrito.', 'alerta'); return; }
        this.imprimirRecetaDatos(this.datosRecetaDe(p, { dosis: p.nombre, tipo: 'respaldo' }));
    },

    imprimirRecetaDatos: function (datos) {
        const w = window.open('', '_blank', 'noopener,width=720,height=900');
        if (!w) { BelenUI.toast('El navegador bloqueó la ventana de impresión. Permita ventanas emergentes para la receta.', 'alerta'); return; }
        w.document.write(BelenStore.htmlRecetaImprimible(datos));
        w.document.close();
        w.focus();
        setTimeout(() => { try { w.print(); } catch (err) { /* la ventana ya muestra la receta */ } }, 250);
    },

    htmlPaquetesFarmacia: function () {
        const S = BelenStore, e = t => this.e(t);
        const paquetes = S.listarPaquetes();
        if (!paquetes.length) return '<div class="text-center py-16 text-slate-400 bg-white rounded-2xl border border-dashed border-slate-300">No hay paquetes. Cree el primero con Nuevo paquete.</div>';
        return `<div class="grid grid-cols-1 md:grid-cols-2 gap-4">${paquetes.map(p => {
            const items = p.items.map(it => {
                const prod = S.productoPorSku(it.sku);
                return `<li class="flex justify-between gap-3 py-1"><span>${e(prod ? prod.nombre : it.sku)}</span><span class="font-bold">${it.cantidad}×</span></li>`;
            }).join('');
            return `<article class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                <h3 class="font-extrabold text-slate-900">${e(p.nombre)}</h3>
                <ul class="mt-3 text-sm text-slate-600">${items}</ul>
                <div class="mt-4 flex flex-wrap gap-2">
                    <button type="button" onclick="AdminController.meterPaqueteEnCarrito('${e(p.paquete_id)}')" class="bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold px-3 py-2 rounded-lg">Aplicar al carrito</button>
                    <button type="button" onclick="AdminController.abrirEditorPaquete('${e(p.paquete_id)}')" class="bg-white border border-slate-300 text-xs font-bold px-3 py-2 rounded-lg">Editar</button>
                    <button type="button" onclick="AdminController.eliminarPaqueteFarmacia('${e(p.paquete_id)}')" class="text-red-600 text-xs font-bold px-3 py-2">Eliminar</button>
                </div>
            </article>`;
        }).join('')}</div>`;
    },

    skusParaPaquete: function () {
        const vistos = {}, out = [];
        BelenStore.listarInventarioFarmacia(this.sesion).forEach(p => {
            if (vistos[p.sku] || p.fraccion_cofepris === 'I') return;
            vistos[p.sku] = true;
            out.push(p);
        });
        return out.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    },

    abrirEditorPaquete: function (paqueteId) {
        const S = BelenStore, e = t => this.e(t);
        const paq = paqueteId ? S.listarPaquetes().find(p => p.paquete_id === paqueteId) : null;
        const skus = this.skusParaPaquete();
        const opciones = skus.map(p => `<option value="${e(p.sku)}">${e(p.nombre)} · ${e(p.sku)}</option>`).join('');
        const fila = (sku, cant) => `<div class="flex gap-2 items-center" data-fila-paq>
            <select class="flex-1 border border-slate-300 rounded-lg p-2 text-sm bg-white" data-sku-paq>${opciones.replace(`value="${e(sku)}"`, `value="${e(sku)}" selected`)}</select>
            <input data-cant-paq type="number" min="1" max="99" value="${cant || 1}" class="w-20 border border-slate-300 rounded-lg p-2 text-sm">
            <button type="button" data-quitar-paq class="text-slate-400 hover:text-red-600 px-2" aria-label="Quitar ítem"><i class="fas fa-xmark"></i></button></div>`;
        const iniciales = (paq ? paq.items : [{ sku: skus[0] ? skus[0].sku : '', cantidad: 1 }]).map(it => fila(it.sku, it.cantidad)).join('');
        BelenUI.modal({
            titulo: paq ? 'Editar paquete' : 'Nuevo paquete', icono: 'fa-kit-medical', ancho: 'lg',
            html: `<div class="space-y-3 text-left">
                <label class="block text-[11px] font-bold text-slate-500 uppercase">Nombre</label>
                <input id="paq-nombre" value="${e(paq ? paq.nombre : '')}" data-autofoco class="w-full border border-slate-300 rounded-lg p-2.5 text-sm">
                <div id="paq-items" class="space-y-2">${iniciales}</div>
                <button type="button" id="paq-agregar" class="text-xs font-bold text-teal-700">+ Agregar ítem</button>
                <p id="paq-error" class="text-xs text-red-600 hidden"></p>
            </div>`,
            alMostrar: c => {
                const caja = c.el.querySelector('#paq-items');
                const enganchar = filaEl => filaEl.querySelector('[data-quitar-paq]').addEventListener('click', () => { if (caja.children.length > 1) filaEl.remove(); });
                Array.from(caja.children).forEach(enganchar);
                c.el.querySelector('#paq-agregar').addEventListener('click', () => {
                    const wrap = document.createElement('div');
                    wrap.innerHTML = fila(skus[0] ? skus[0].sku : '', 1);
                    const nodo = wrap.firstElementChild;
                    caja.appendChild(nodo);
                    enganchar(nodo);
                });
            },
            botones: [
                { texto: 'Cancelar', estilo: 'secundario' },
                { texto: 'Guardar paquete', estilo: 'exito', alPulsar: c => {
                    const items = Array.from(c.el.querySelectorAll('[data-fila-paq]')).map(f => ({ sku: f.querySelector('[data-sku-paq]').value, cantidad: f.querySelector('[data-cant-paq]').value }));
                    const r = S.guardarPaquete({ nombre: c.el.querySelector('#paq-nombre').value, items: items }, this.sesion, paq ? paq.paquete_id : null);
                    const error = c.el.querySelector('#paq-error');
                    if (!r.ok) { error.textContent = (r.errores && (r.errores.nombre || r.errores.items)) || r.motivo; error.classList.remove('hidden'); return false; }
                    BelenUI.toast('Paquete guardado.', 'exito');
                    this.pestanaFarmacia = 'paquetes';
                    this.render();
                } }
            ]
        });
    },

    eliminarPaqueteFarmacia: function (paqueteId) {
        const paq = BelenStore.listarPaquetes().find(p => p.paquete_id === paqueteId);
        if (!paq) return;
        BelenUI.confirmar({
            titulo: 'Eliminar paquete', mensaje: 'Se eliminará "' + paq.nombre + '". Los cargos ya hechos no se modifican.', tipo: 'peligro', textoConfirmar: 'Eliminar',
            alConfirmar: () => {
                const r = BelenStore.eliminarPaquete(paqueteId, this.sesion);
                if (!r.ok) { BelenUI.toast(r.motivo, 'alerta'); return; }
                BelenUI.toast('Paquete eliminado.', 'info');
                this.render();
            }
        });
    },

    textoAtribucionCargo: function (c) {
        const cuando = c && (c.fecha_hora || c.cargado_en);
        const quien = c && c.cargado_por_nombre;
        if (!cuando && !quien) return 'Sin registro';
        return (cuando ? BelenStore.fechaHoraLegible(cuando) : 'Sin hora') + (quien ? ' · ' + quien : '');
    },

    // ======================================================================
    // VISTA: GESTIÓN DE PERSONAL (exclusiva del administrador): permisos dinámicos por módulo
    // ======================================================================
    htmlPersonal: function () {
        const S = BelenStore, e = t => this.e(t);
        const interruptor = (u, m) => {
            const activo = S.permisoModuloDe(u.id, m.permiso), fijo = u.rol === 'admin';
            return `<button type="button" role="switch" aria-checked="${activo}" aria-label="${e(m.etiqueta)} para ${e(u.nombre)}" data-switch="1" data-usuario="${e(u.id)}" data-permiso="${m.permiso}" ${fijo ? 'disabled' : ''}
                    onclick="AdminController.alternarModulo('${e(u.id)}','${m.permiso}')"
                    class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${activo ? 'bg-cyan-600' : 'bg-slate-300'} ${fijo ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}">
                    <span class="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${activo ? 'translate-x-6' : 'translate-x-1'}"></span></button>`;
        };
        const ajustes = S.leerPermisosPersonal();
        const filas = Object.values(S.USUARIOS).sort((a, b) => (a.rol === 'admin' ? -1 : 0) - (b.rol === 'admin' ? -1 : 0) || a.nombre.localeCompare(b.nombre, 'es')).map(u => {
            const rol = S.ROLES[u.rol] || { corta: u.rol, etiqueta: u.rol };
            const color = S.colorDeUsuario(u);
            const esp = u.rol === 'medico' ? (S.especialidadPorCodigo(u.especialidad_codigo) || {}).nombre : u.cargo;
            const docs = S.listarPapeleria(u.id).length;
            const personalizado = !!ajustes[u.id] && Object.keys(ajustes[u.id]).length > 0;
            const busca = S.normalizar([u.nombre, u.id, rol.etiqueta, rol.corta, u.cedula_profesional, u.etiqueta_admin, esp].join(' '));
            const btn = (accion, texto, extra) => `<button type="button" onclick="AdminController.${accion}('${e(u.id)}')" class="text-[11px] font-bold px-2 py-1 rounded-md border border-slate-200 hover:border-cyan-400 hover:text-cyan-800 ${extra || ''}">${texto}</button>`;
            return `<tr class="border-t border-slate-100 hover:bg-slate-50/70 ${u.activo === false ? 'opacity-60' : ''}" data-usuario-fila="${e(u.id)}" data-busca="${e(busca)}">
                <td class="px-4 py-3"><div class="flex items-center gap-3">
                    <div class="w-9 h-9 rounded-full ${color} flex items-center justify-center text-xs font-bold shrink-0">${e(S.iniciales(u.nombre.replace(/^(Dra?\.|Enf\.|Adm\.)\s*/, '')))}</div>
                    <div><p class="font-bold text-slate-800 leading-tight">${e(u.nombre)}${u.activo === false ? ' <span class="text-[10px] uppercase text-red-600">Inactivo</span>' : ''}</p>
                        <p class="text-[11px] text-slate-400 font-mono">${e(u.id)}${u.cedula_profesional ? ' · ' + e(u.cedula_profesional) : ''}</p>
                        ${u.etiqueta_admin ? `<p class="text-[11px] text-amber-700">${e(u.etiqueta_admin)}</p>` : ''}</div></div></td>
                <td class="px-4 py-3"><span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded whitespace-nowrap ${color}">${e(rol.corta)}</span><p class="text-xs text-slate-500 mt-1">${e(esp || '')}</p></td>
                ${S.MODULOS.map(m => `<td class="px-4 py-3 text-center">${interruptor(u, m)}</td>`).join('')}
                <td class="px-4 py-3"><div class="flex flex-wrap gap-1 justify-end">
                    ${btn('abrirEditarPersonal', 'Editar')}
                    ${btn('abrirPapeleria', 'Carpeta / Papelería (' + docs + ')')}
                    ${u.rol === 'admin' ? '' : btn('abrirPermisosAvanzados', 'Permisos avanzados')}
                    ${u.rol === 'admin' ? '<span class="text-[11px] text-slate-400 px-1">Acceso total</span>' : (u.activo === false ? btn('confirmarReactivar', 'Reactivar') + btn('confirmarEliminarPersonal', 'Eliminar', 'text-red-600') : btn('confirmarDesactivar', 'Desactivar', 'text-red-600'))}
                    ${u.rol !== 'admin' && personalizado ? `<button type="button" data-accion="restablecer-usuario" onclick="AdminController.restablecerUsuario('${e(u.id)}')" class="text-[11px] font-bold text-slate-500 hover:text-cyan-700 underline underline-offset-2">Valores del perfil</button>` : ''}
                </div></td></tr>`;
        }).join('');
        return `<div class="mb-6 flex flex-wrap items-end justify-between gap-3">
                    <div><h2 class="text-2xl font-extrabold text-slate-800">Gestión de Personal</h2>
                    <p class="text-slate-500">Altas, papelería y permisos de cada persona. Un módulo encendido aparece en su menú aunque su perfil no lo trajera de fábrica.</p></div>
                    <button type="button" onclick="AdminController.abrirEditarPersonal('')" class="bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold py-2.5 px-4 rounded-lg shadow-sm flex items-center gap-2"><i class="fas fa-plus"></i> Agregar Personal</button></div>
                <input id="buscar-personal" type="search" oninput="AdminController.filtrarPersonal(this.value)" placeholder="Buscar por nombre, usuario, rol, cédula o etiqueta" class="w-full mb-4 border border-slate-300 rounded-xl px-4 py-2.5 text-sm focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none">
                <div class="mb-6 bg-cyan-50 border border-cyan-200 text-cyan-800 text-xs rounded-xl px-4 py-3 flex items-start gap-2"><i class="fas fa-circle-info mt-0.5"></i>
                    <span>Los interruptores se guardan al instante y aplican en la siguiente sesión. La contraseña de demostración de las cuentas sembradas es <b>demo</b>. Alfonso conserva todos los módulos.</span></div>
                <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-x-auto"><table class="w-full text-sm text-left" id="tabla-personal">
                    <thead class="bg-slate-50 text-[11px] uppercase text-slate-400"><tr><th class="px-4 py-3">Personal</th><th class="px-4 py-3">Perfil</th>
                        ${S.MODULOS.map(m => `<th class="px-4 py-3 text-center whitespace-nowrap"><i class="fas ${m.icono} mr-1 text-slate-400"></i>${e(m.etiqueta)}</th>`).join('')}<th class="px-4 py-3 text-right">Acciones</th></tr></thead>
                    <tbody>${filas}</tbody></table></div>
                <p id="personal-vacio" class="hidden text-center text-sm text-slate-400 py-8">Nadie coincide con la búsqueda.</p>`;
    },

    filtrarPersonal: function (texto) {
        const n = BelenStore.normalizar(texto);
        let visibles = 0;
        document.querySelectorAll('#tabla-personal tbody tr').forEach(tr => {
            const ok = !n || (tr.getAttribute('data-busca') || '').indexOf(n) >= 0;
            tr.style.display = ok ? '' : 'none';
            if (ok) visibles++;
        });
        const vacio = document.getElementById('personal-vacio');
        if (vacio) vacio.classList.toggle('hidden', visibles > 0);
    },

    abrirEditarPersonal: function (id) {
        const S = BelenStore, u = id ? S.USUARIOS[id] : null;
        if (id && !u) { BelenUI.toast('No se encontró al empleado.', 'alerta'); return; }
        const e = t => this.e(t);
        const cls = 'w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 bg-white';
        const roles = Object.values(S.ROLES).map(r => `<option value="${r.codigo}" ${u && u.rol === r.codigo ? 'selected' : ''}>${e(r.etiqueta)}</option>`).join('');
        const esps = S.ESPECIALIDADES.map(x => `<option value="${x.codigo}" ${u && u.especialidad_codigo === x.codigo ? 'selected' : ''}>${e(x.nombre)}</option>`).join('');
        const colores = Object.keys(S.COLORES_DISTINTIVO).map(k => `<option value="${k}" ${u && u.color_distintivo === k ? 'selected' : ''}>${e(S.COLORES_DISTINTIVO[k].etiqueta)}</option>`).join('');
        BelenUI.modal({
            titulo: u ? 'Editar personal' : 'Agregar personal', subtitulo: u ? u.nombre : 'La contraseña de las cuentas demo es demo.', icono: 'fa-user-plus', ancho: 'lg',
            html: `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label class="block text-[11px] font-bold text-slate-500 uppercase mb-1" for="rh-id">Usuario</label><input id="rh-id" class="${cls}" value="${u ? e(u.id) : ''}" ${u && u.id === 'admin' ? 'readonly' : ''} data-autofoco><p data-err="id" class="text-[11px] text-red-600 mt-1 hidden"></p></div>
                <div><label class="block text-[11px] font-bold text-slate-500 uppercase mb-1" for="rh-nombre">Nombre</label><input id="rh-nombre" class="${cls}" value="${u ? e(u.nombre) : ''}"><p data-err="nombre" class="text-[11px] text-red-600 mt-1 hidden"></p></div>
                <div><label class="block text-[11px] font-bold text-slate-500 uppercase mb-1" for="rh-password">Contraseña ${u ? '(vacío = no cambiar)' : ''}</label><input id="rh-password" type="password" class="${cls}" autocomplete="new-password"><p data-err="password" class="text-[11px] text-red-600 mt-1 hidden"></p></div>
                <div><label class="block text-[11px] font-bold text-slate-500 uppercase mb-1" for="rh-rol">Perfil</label><select id="rh-rol" class="${cls}" ${u && u.id === 'admin' ? 'disabled' : ''}>${roles}</select><p data-err="rol" class="text-[11px] text-red-600 mt-1 hidden"></p></div>
                <div><label class="block text-[11px] font-bold text-slate-500 uppercase mb-1" for="rh-cargo">Cargo</label><input id="rh-cargo" class="${cls}" value="${u ? e(u.cargo) : ''}"><p data-err="cargo" class="text-[11px] text-red-600 mt-1 hidden"></p></div>
                <div><label class="block text-[11px] font-bold text-slate-500 uppercase mb-1" for="rh-cedula">Cédula profesional</label><input id="rh-cedula" class="${cls}" value="${u ? e(u.cedula_profesional || '') : ''}"><p data-err="cedula_profesional" class="text-[11px] text-red-600 mt-1 hidden"></p></div>
                <div><label class="block text-[11px] font-bold text-slate-500 uppercase mb-1" for="rh-esp">Especialidad</label><select id="rh-esp" class="${cls}"><option value="">No aplica</option>${esps}</select><p data-err="especialidad_codigo" class="text-[11px] text-red-600 mt-1 hidden"></p></div>
                <div><label class="block text-[11px] font-bold text-slate-500 uppercase mb-1" for="rh-color">Color distintivo</label><select id="rh-color" class="${cls}">${colores}</select></div>
                <div class="sm:col-span-2"><label class="block text-[11px] font-bold text-slate-500 uppercase mb-1" for="rh-etiqueta">Etiqueta informal</label><input id="rh-etiqueta" class="${cls}" maxlength="80" value="${u ? e(u.etiqueta_admin || '') : ''}" placeholder="Nota visible solo para administración"><p data-err="etiqueta_admin" class="text-[11px] text-red-600 mt-1 hidden"></p></div>
            </div>`,
            alMostrar: c => {
                const rol = c.el.querySelector('#rh-rol'), esp = c.el.querySelector('#rh-esp');
                const sync = () => { esp.disabled = rol.value !== 'medico'; if (rol.value !== 'medico') esp.value = ''; };
                rol.addEventListener('change', sync); sync();
            },
            botones: [
                { texto: 'Cancelar', estilo: 'secundario' },
                { texto: u ? 'Guardar cambios' : 'Crear usuario', estilo: 'primario', alPulsar: c => {
                    const q = sel => c.el.querySelector(sel).value;
                    const r = S.guardarUsuario({
                        id: q('#rh-id'), nombre: q('#rh-nombre'), password: q('#rh-password'), rol: c.el.querySelector('#rh-rol').disabled ? 'admin' : q('#rh-rol'),
                        cargo: q('#rh-cargo'), cedula_profesional: q('#rh-cedula'), especialidad_codigo: q('#rh-esp'), color_distintivo: q('#rh-color'), etiqueta_admin: q('#rh-etiqueta')
                    }, this.sesion, u ? u.id : null);
                    c.el.querySelectorAll('[data-err]').forEach(p => p.classList.add('hidden'));
                    if (!r.ok) {
                        Object.keys(r.errores || {}).forEach(k => { const p = c.el.querySelector(`[data-err="${k}"]`); if (p) { p.textContent = r.errores[k]; p.classList.remove('hidden'); } });
                        if (!r.errores) BelenUI.toast(r.motivo, 'alerta');
                        return false;
                    }
                    BelenUI.toast(u ? 'Datos actualizados.' : 'Persona dada de alta.', 'exito');
                    this.render();
                } }
            ]
        });
    },

    confirmarDesactivar: function (id) {
        const u = BelenStore.USUARIOS[id];
        if (!u) return;
        BelenUI.confirmar({
            titulo: 'Desactivar a ' + u.nombre, mensaje: 'No podrá iniciar sesión. Su historial clínico y sus cirugías se conservan.', tipo: 'alerta', textoConfirmar: 'Desactivar',
            alConfirmar: () => {
                const r = BelenStore.desactivarUsuario(id, this.sesion);
                if (!r.ok) { BelenUI.toast(r.motivo, 'alerta'); return; }
                BelenUI.toast(u.nombre + ' quedó inactivo.', 'info');
                this.render();
            }
        });
    },
    confirmarReactivar: function (id) {
        const u = BelenStore.USUARIOS[id];
        if (!u) return;
        const r = BelenStore.reactivarUsuario(id, this.sesion);
        if (!r.ok) { BelenUI.toast(r.motivo, 'alerta'); return; }
        BelenUI.toast(u.nombre + ' puede volver a entrar.', 'exito');
        this.render();
    },
    confirmarEliminarPersonal: function (id) {
        const u = BelenStore.USUARIOS[id];
        if (!u) return;
        BelenUI.confirmar({
            titulo: 'Eliminar a ' + u.nombre, mensaje: 'Se borra la cuenta y su papelería. Los expedientes donde participó conservan el nombre ya registrado.', tipo: 'peligro', textoConfirmar: 'Eliminar definitivamente',
            alConfirmar: () => {
                const r = BelenStore.eliminarUsuario(id, this.sesion);
                if (!r.ok) { BelenUI.toast(r.motivo, 'alerta'); return; }
                BelenUI.toast('Cuenta eliminada.', 'info');
                this.render();
            }
        });
    },

    abrirPermisosAvanzados: function (id) {
        const S = BelenStore, u = S.USUARIOS[id];
        if (!u || u.rol === 'admin') return;
        const e = t => this.e(t);
        const etiquetas = { capturar_signos: 'Capturar signos', pasar_a_medico: 'Pasar a médico', cargar_consumos: 'Cargar consumos', asignar_cama: 'Asignar cama', programar_cirugia: 'Programar cirugía', gestionar_farmacia: 'Gestionar farmacia' };
        const filas = S.ACCIONES_PERSONAL.map(a => {
            const on = S.permisoAccionDe(id, a);
            return `<div class="flex items-center justify-between gap-3 py-2 border-b border-slate-100">
                <span class="text-sm text-slate-700">${e(etiquetas[a])}</span>
                <button type="button" role="switch" aria-checked="${on}" data-accion-perm="${a}" class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full ${on ? 'bg-cyan-600' : 'bg-slate-300'}"><span class="inline-block h-4 w-4 rounded-full bg-white shadow ${on ? 'translate-x-6' : 'translate-x-1'}"></span></button></div>`;
        }).join('');
        BelenUI.modal({
            titulo: 'Permisos avanzados', subtitulo: u.nombre, icono: 'fa-sliders', ancho: 'md',
            html: `<div id="permisos-avanzados">${filas}</div>`,
            alMostrar: c => c.el.querySelectorAll('[data-accion-perm]').forEach(b => b.addEventListener('click', () => {
                const accion = b.getAttribute('data-accion-perm');
                const nuevo = !S.permisoAccionDe(id, accion);
                if (!S.establecerPermisoAccion(id, accion, nuevo)) { BelenUI.toast('No se pudo guardar.', 'alerta'); return; }
                b.setAttribute('aria-checked', nuevo);
                b.classList.toggle('bg-cyan-600', nuevo); b.classList.toggle('bg-slate-300', !nuevo);
                b.firstElementChild.classList.toggle('translate-x-6', nuevo); b.firstElementChild.classList.toggle('translate-x-1', !nuevo);
                BelenUI.toast(etiquetas[accion] + (nuevo ? ' activado.' : ' desactivado.'), nuevo ? 'exito' : 'info');
            })),
            botones: [{ texto: 'Cerrar', estilo: 'secundario' }]
        });
    },

    abrirPapeleria: function (id) {
        const S = BelenStore, u = S.USUARIOS[id];
        if (!u) return;
        const e = t => this.e(t);
        const docs = S.listarPapeleria(id);
        const filas = docs.map(d => `<div class="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-slate-100">
            <div><p class="text-sm font-semibold text-slate-800">${e(d.titulo)}</p><p class="text-[11px] text-slate-400">${e(d.nombre_archivo)} · ${e(S.fechaHoraLegible(d.fecha))}</p></div>
            <div class="flex gap-1">
                <button type="button" data-doc="${e(d.doc_id)}" data-ver="1" class="text-[11px] font-bold px-2 py-1 rounded-md border border-slate-200">Ver</button>
                <button type="button" data-doc="${e(d.doc_id)}" data-bajar="1" class="text-[11px] font-bold px-2 py-1 rounded-md border border-slate-200">Descargar</button>
                <button type="button" data-doc="${e(d.doc_id)}" data-borrar="1" class="text-[11px] font-bold px-2 py-1 rounded-md border border-red-200 text-red-600">Eliminar</button>
            </div></div>`).join('');
        const ctrl = BelenUI.modal({
            titulo: 'Carpeta de ' + u.nombre, subtitulo: docs.length + ' documento' + (docs.length === 1 ? '' : 's'), icono: 'fa-folder-open', ancho: 'lg',
            html: `<div class="flex flex-wrap gap-2 mb-3">
                    <input id="rh-titulo-doc" placeholder="Título del documento" class="flex-1 min-w-[140px] border border-slate-300 rounded-lg px-3 py-2 text-sm">
                    <input id="rh-archivo" type="file" accept="application/pdf,image/*" class="text-xs">
                    <button type="button" id="rh-subir" class="bg-cyan-700 text-white text-xs font-bold px-3 py-2 rounded-lg">Subir</button>
                    <button type="button" id="rh-zip" class="bg-slate-800 text-white text-xs font-bold px-3 py-2 rounded-lg">Descargar todo</button>
                </div>
                <div id="rh-lista">${filas || '<p class="text-sm text-slate-400 text-center py-6">Todavía no hay documentos.</p>'}</div>`,
            botones: [{ texto: 'Cerrar', estilo: 'secundario' }]
        });
        const self = this;
        const docDe = docId => S.listarPapeleria(id).find(d => d.doc_id === docId);
        ctrl.el.querySelector('#rh-subir').addEventListener('click', () => {
            const archivo = ctrl.el.querySelector('#rh-archivo').files[0];
            const titulo = ctrl.el.querySelector('#rh-titulo-doc').value;
            if (!archivo) { BelenUI.toast('Seleccione un PDF o una imagen.', 'alerta'); return; }
            const lector = new FileReader();
            lector.onload = () => {
                const r = S.agregarDocumentoPersonal(id, { titulo: titulo || archivo.name, nombre_archivo: archivo.name, data_url: lector.result }, self.sesion);
                if (!r.ok) { BelenUI.toast(r.motivo, 'alerta'); return; }
                BelenUI.toast('Documento guardado.', 'exito');
                ctrl.cerrar();
                self.render();
                self.abrirPapeleria(id);
            };
            lector.readAsDataURL(archivo);
        });
        ctrl.el.querySelector('#rh-zip').addEventListener('click', () => self.descargarExpediente(id));
        ctrl.el.querySelectorAll('[data-doc]').forEach(b => b.addEventListener('click', () => {
            const doc = docDe(b.getAttribute('data-doc'));
            if (!doc) return;
            if (b.hasAttribute('data-ver')) self.previsualizarDocumento(doc);
            if (b.hasAttribute('data-bajar')) self.descargarDataUrl(doc.nombre_archivo, doc.data_url);
            if (b.hasAttribute('data-borrar')) BelenUI.confirmar({
                titulo: 'Eliminar documento', mensaje: doc.titulo, tipo: 'peligro', textoConfirmar: 'Eliminar',
                alConfirmar: () => {
                    const r = S.eliminarDocumentoPersonal(id, doc.doc_id, self.sesion);
                    if (!r.ok) { BelenUI.toast(r.motivo, 'alerta'); return; }
                    BelenUI.toast('Documento eliminado.', 'info');
                    ctrl.cerrar();
                    self.render();
                    self.abrirPapeleria(id);
                }
            });
        }));
    },

    previsualizarDocumento: function (doc) {
        const imagen = String(doc.tipo || '').indexOf('image/') === 0;
        BelenUI.modal({
            titulo: doc.titulo, subtitulo: doc.nombre_archivo, icono: 'fa-file', ancho: 'xl',
            html: imagen ? '<img alt="" class="max-h-[65vh] mx-auto rounded-lg">' : '<iframe title="Documento" class="w-full h-[65vh] rounded-lg border border-slate-200"></iframe>',
            alMostrar: c => { const el = c.cuerpo.querySelector(imagen ? 'img' : 'iframe'); if (el) el.src = doc.data_url; },
            botones: [
                { texto: 'Descargar', estilo: 'primario', alPulsar: () => { this.descargarDataUrl(doc.nombre_archivo, doc.data_url); return false; } },
                { texto: 'Cerrar', estilo: 'secundario' }
            ]
        });
    },
    descargarDataUrl: function (nombre, dataUrl) {
        const a = document.createElement('a');
        a.href = dataUrl; a.download = nombre || 'documento';
        document.body.appendChild(a); a.click(); a.remove();
    },
    descargarExpediente: function (id) {
        const docs = BelenStore.listarPapeleria(id);
        if (!docs.length) { BelenUI.toast('La carpeta no tiene documentos.', 'alerta'); return; }
        const archivos = docs.map((d, i) => ({ nombre: (i + 1) + '-' + (d.nombre_archivo || 'documento'), bytes: this.bytesDeDataUrl(d.data_url) }));
        const blob = new Blob([this.zipStore(archivos)], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        this.descargarDataUrl('expediente-' + id + '.zip', url);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    },
    bytesDeDataUrl: function (dataUrl) {
        const b64 = String(dataUrl).split(',')[1] || '';
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
    },
    zipStore: function (archivos) {
        const crc32 = bytes => {
            let c = -1;
            for (let i = 0; i < bytes.length; i++) { c ^= bytes[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
            return (~c) >>> 0;
        };
        const u16 = (n, a) => { a.push(n & 255, (n >> 8) & 255); };
        const u32 = (n, a) => { u16(n, a); u16(n >>> 16, a); };
        const local = [], central = [], offsets = [];
        archivos.forEach(f => {
            const nombre = new TextEncoder().encode(f.nombre.replace(/[\\/]/g, '-'));
            const crc = crc32(f.bytes);
            offsets.push(local.length);
            const h = [0x50, 0x4b, 0x03, 0x04]; u16(20, h); u16(0, h); u16(0, h); u16(0, h); u16(0, h); u32(crc, h); u32(f.bytes.length, h); u32(f.bytes.length, h); u16(nombre.length, h); u16(0, h);
            h.forEach(b => local.push(b)); nombre.forEach(b => local.push(b)); f.bytes.forEach(b => local.push(b));
            const c = [0x50, 0x4b, 0x01, 0x02]; u16(20, c); u16(20, c); u16(0, c); u16(0, c); u16(0, c); u16(0, c); u32(crc, c); u32(f.bytes.length, c); u32(f.bytes.length, c); u16(nombre.length, c); u16(0, c); u16(0, c); u16(0, c); u16(0, c); u32(0, c); u32(offsets[offsets.length - 1], c);
            c.forEach(b => central.push(b)); nombre.forEach(b => central.push(b));
        });
        const start = local.length;
        const end = [0x50, 0x4b, 0x05, 0x06]; u16(0, end); u16(0, end); u16(archivos.length, end); u16(archivos.length, end); u32(central.length, end); u32(start, end); u16(0, end);
        return new Uint8Array(local.concat(central, end));
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
            const turnos = S.listarTurnos().filter(t => t.paciente_id === p.paciente_id)
                .sort((a, b) => String(b.actualizado_en || b.timestamp_llegada || '').localeCompare(String(a.actualizado_en || a.timestamp_llegada || '')));
            const ultimo = turnos[0];
            const archivoHosp = turnos.find(t => (t.estatus === 'cerrado_historico' || t.estatus === 'alta_medica_pendiente_pago') && S.internamientoDeTurno(t.turno_id));
            const badge = ultimo ? this.badgeEstatus(ultimo) : '<span class="text-slate-400">—</span>';
            const portafolio = archivoHosp
                ? `<a href="expediente.html?modo=hospitalizado&turno=${encodeURIComponent(archivoHosp.turno_id)}" class="text-xs font-bold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg px-3 py-1.5 transition inline-flex items-center gap-1"><i class="fas fa-folder-tree"></i> Portafolio</a>`
                : '';
            const buscar = S.normalizar([p.nombre_completo, p.paciente_id, ultimo && ultimo.dx_principal, ultimo && ultimo.medico_nombre, ultimo && ultimo.estatus, archivoHosp ? 'cerrado historico portafolio' : ''].filter(Boolean).join(' '));
            return `<tr class="border-t border-slate-100 hover:bg-slate-50" data-paciente="${this.e(p.paciente_id)}" data-buscar="${this.e(buscar)}">
                <td class="px-4 py-3 font-bold text-slate-800">${this.e(p.nombre_completo)}<span class="block text-[11px] font-normal text-slate-400">${this.e(p.paciente_id)}</span></td>
                <td class="px-4 py-3 text-slate-600">${edad !== null ? edad + ' años' : '—'} · ${p.sexo === 'F' ? 'Femenino' : 'Masculino'}</td>
                <td class="px-4 py-3 text-slate-600">${badge || '<span class="text-slate-400">—</span>'}</td>
                <td class="px-4 py-3 text-slate-600 text-center">${v.length}</td>
                <td class="px-4 py-3 text-slate-600">${ultima}</td>
                <td class="px-4 py-3 text-right whitespace-nowrap"><div class="inline-flex flex-wrap justify-end gap-2">${portafolio}<button type="button" data-accion="ver-visitas" onclick="AdminController.verVisitasPaciente('${this.e(p.paciente_id)}')" class="text-xs font-bold text-cyan-700 hover:text-cyan-900 bg-cyan-50 hover:bg-cyan-100 rounded-lg px-3 py-1.5 transition" ${v.length ? '' : 'disabled style="opacity:.4;cursor:not-allowed"'}>Ver visitas</button></div></td></tr>`;
        }).join('');
        return `<div class="mb-6"><h2 class="text-2xl font-extrabold text-slate-800">Búsqueda Histórica</h2>
                    <p class="text-slate-500">${this.rolActual === 'medico' ? 'Archivo de los pacientes que usted ha atendido. Los expedientes cerrados ya no aparecen en los monitores activos.' : 'Archivo longitudinal. Un expediente cerrado sale de camas, fila y caja, y se consulta solo aquí.'}</p></div>
                <div class="mb-4 relative max-w-xl">
                    <i class="fas fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
                    <input id="busqueda-historica" type="search" autocomplete="off" placeholder="Buscar por nombre, expediente o diagnóstico" oninput="AdminController.filtrarHistorico(this.value)"
                        class="w-full border border-slate-300 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-800 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none bg-white">
                </div>
                <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"><table class="w-full text-sm text-left" id="tabla-historico">
                    <thead class="bg-slate-50 text-[11px] uppercase text-slate-400"><tr><th class="px-4 py-3">Paciente</th><th class="px-4 py-3">Edad y sexo</th><th class="px-4 py-3">Estatus</th><th class="px-4 py-3 text-center">Visitas</th><th class="px-4 py-3">Última visita</th><th class="px-4 py-3"></th></tr></thead>
                    <tbody>${filas || '<tr><td colspan="6" class="px-4 py-10 text-center text-slate-400">No hay expedientes para mostrar.</td></tr>'}</tbody></table>
                    <p id="historico-vacio" class="hidden px-4 py-10 text-center text-slate-400">Ningún expediente coincide con la búsqueda.</p></div>`;
    },

    filtrarHistorico: function (texto) {
        const n = BelenStore.normalizar(texto);
        const filas = Array.from(document.querySelectorAll('#tabla-historico tbody tr[data-buscar]'));
        let visibles = 0;
        filas.forEach(tr => {
            const ok = !n || String(tr.getAttribute('data-buscar') || '').indexOf(n) >= 0;
            tr.classList.toggle('hidden', !ok);
            if (ok) visibles++;
        });
        const vacio = document.getElementById('historico-vacio');
        if (vacio) vacio.classList.toggle('hidden', !filas.length || visibles !== 0);
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
