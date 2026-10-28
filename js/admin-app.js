// Archivo: js/admin-app.js
// ============================================================
// CONTROLADOR DEL DASHBOARD (vistas por rol y por médico)
// Vistas: central | fila | hospitalizacion | cirugias | expedientes | personal | tarifario | farmacia   (?vista=...)
// Datos: BelenStore (js/belen-store.js). Interfaz: BelenUI (js/belen-ui.js).
// CERO alert()/prompt()/confirm() nativos: todo con modales Tailwind.
// ============================================================

const AdminController = {
    rolActual: null,
    sesion: null,
    vista: 'central',
    filtroEspecialidad: '',
    pestanaFarmacia: 'terminal',
    pestanaTarifario: 'catalogo',
    cuentaDestacada: null,
    pacienteMoverPlanoId: "",
    mostrarMapa2D: true,
    filtroRecetasTexto: "",
    filtroRecetasFraccion: "",
    filtroCategoriaEstudio: '',
    buscaEstudio: '',
    carritoFarmacia: [],
    pacienteCargoId: null,
    enfermeraCargoId: '',
    operadorFarmaciaId: null,
    modoRetiroAdmin: false,
    modoExterno: false,
    folioBuscadoId: null,
    folioBuscadoTexto: '',
    bitacoraAbiertas: {},
    filtrosBitacora: { desde: '', hasta: '', tipo: '', persona: '', medicamento: '', lote: '', clasificacion: '' },
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
        tarifario:       { roles: ['admin', 'administrador'],                                                                     titulo: { admin: 'Tarifario y Caja', administrador: 'Tarifario y Caja' } },
        farmacia:        { roles: ['admin', 'administrador', 'enf_farmacia'], modulo: 'ver_farmacia', titulo: { admin: 'Farmacia e Inventario', administrador: 'Farmacia e Inventario', enf_farmacia: 'Terminal de Farmacia' } }
    },

    init: async function () {
        BelenStore.sembrarDemoSiHaceFalta();
        if (!this.verificarSesion()) return;
        this.aplicarPermisosUI();

        if (this.rolActual === 'enf_farmacia') this.vista = 'farmacia';
        else {
            const params = new URLSearchParams(window.location.search);
            const pedida = params.get('vista');
            this.vista = this.vistaPermitida(pedida) ? pedida : this.vistaInicial();
            if (pedida === 'tarifario' && params.get('turno')) {
                this.pestanaTarifario = 'caja';
                this.cuentaDestacada = params.get('turno');
            }
            if (pedida && !this.vistaPermitida(pedida)) {
                BelenUI.toast('Su perfil no tiene acceso a esa sección.', 'alerta');
                if (this.vista) history.replaceState(null, '', '?vista=' + this.vista);
            }
        }
        await this.render();
        this.enfocarCuenta();

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
        const vivo = BelenStore.USUARIOS[s.usuario_id];
        if (vivo) { s.nombre = vivo.nombre; s.cargo = vivo.cargo; s.rol = vivo.rol; }
        this.sesion = s;
        this.rolActual = s.rol;
        document.getElementById('user-name').innerText = s.nombre;
        document.getElementById('user-role').innerText = s.rol === 'medico' ? s.especialidad : s.cargo;
        const unm = document.getElementById('user-name-movil');
        const urm = document.getElementById('user-role-movil');
        if (unm) unm.innerText = s.nombre;
        if (urm) urm.innerText = s.rol === 'medico' ? s.especialidad : s.cargo;
        const btnCed = document.getElementById('btn-mis-cedulas');
        if (btnCed) btnCed.classList.toggle('hidden', s.rol !== 'medico');
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
        if (v === 'farmacia' && this.rolActual !== 'admin' && this.rolActual !== 'administrador' && this.rolActual !== 'enf_farmacia') return false;
        const concedido = d.modulo && BelenStore.permisoModuloExplicito(this.sesion.usuario_id, d.modulo) === true;
        if (!d.roles.includes(this.rolActual) && !concedido) return false;
        return !d.modulo || BelenStore.puede(d.modulo) || concedido;
    },
    // Primera vista disponible para el usuario (null si el administrador le apagó todos los módulos)
    vistaInicial: function () {
        if (this.rolActual === 'enf_farmacia') return 'farmacia';
        return ['central', 'fila', 'hospitalizacion', 'cirugias', 'expedientes', 'personal', 'tarifario', 'farmacia'].find(v => this.vistaPermitida(v)) || null;
    },

    alternarSidebarMovil: function (forzar) {
        const aside = document.getElementById('sidebar-principal') || document.querySelector('aside');
        const backdrop = document.getElementById('sidebar-backdrop');
        if (!aside) return;
        const estaAbierto = !aside.classList.contains('-translate-x-full');
        const abrir = typeof forzar === 'boolean' ? forzar : !estaAbierto;
        aside.classList.toggle('-translate-x-full', !abrir);
        aside.classList.toggle('translate-x-0', abrir);
        if (backdrop) backdrop.classList.toggle('hidden', !abrir);
    },

    navegar: function (vista, ev) {
        if (ev) ev.preventDefault();
        this.alternarSidebarMovil(false);
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
        this.pintarBarraKiosco();
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
        else if (this.vista === 'tarifario') cont.innerHTML = this.htmlTarifario();
        else if (this.vista === 'farmacia') { cont.innerHTML = this.htmlFarmacia(); this.enlazarTerminalFarmacia(); }
        this.actualizarRelojes();
    },

    // ----------------------------------------------------------------------
    // Utilidades de presentación
    // ----------------------------------------------------------------------
    e: function (t) { return BelenUI.esc(t); },

    edadTexto: function (t) {
        const S = BelenStore;
        const edadTxt = S.formatearEdad ? S.formatearEdad(t.fecha_nacimiento) : (S.calcularEdad(t.fecha_nacimiento) !== null ? S.calcularEdad(t.fecha_nacimiento) + ' años' : '');
        const sexo = t.sexo === 'F' ? 'Femenino' : (t.sexo === 'M' ? 'Masculino' : '');
        const pac = t.paciente_id && S.buscarPacientePorId ? S.buscarPacientePorId(t.paciente_id) : null;
        const nac = t.nacionalidad || (pac && pac.nacionalidad) || '';
        const nacTxt = nac && nac.toLowerCase() !== 'mexicana' ? '🌍 ' + nac : '';
        return [edadTxt, sexo, nacTxt].filter(Boolean).join(' · ');
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
        const S = BelenStore;
        const r = S.signosCompletos(t.signos_vitales) ? S.resumenSignos(t.signos_vitales) : null;
        if (!r) {
            const parcial = !!t.signos_vitales;
            return `<div class="inline-flex items-center gap-2 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                        <i class="fas fa-triangle-exclamation"></i> ${parcial ? 'Signos vitales incompletos' : 'Sin signos vitales'}</div>`;
        }
        const alertas = S.alertasSignosVitales ? S.alertasSignosVitales(t.signos_vitales) : [];
        const criticas = alertas.filter(a => a.nivel === 'critico');
        const badgeAlerta = alertas.length
            ? `<div class="mt-1.5 flex flex-wrap gap-1">${alertas.map(a => `<span class="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded border ${a.nivel === 'critico' ? 'bg-red-50 text-red-700 border-red-300' : 'bg-amber-50 text-amber-800 border-amber-300'}"><i class="fas fa-triangle-exclamation"></i> ${this.e(a.texto)}</span>`).join('')}</div>`
            : '';
        const caja = (et, v, crit) => `<div class="${crit ? 'bg-red-50 border-red-300' : 'bg-slate-50 border-slate-200'} border rounded px-2 py-1 text-center"><p class="text-[9px] ${crit ? 'text-red-500 font-bold' : 'text-slate-400'} uppercase leading-none">${et}</p><p class="text-xs font-bold ${crit ? 'text-red-800' : 'text-slate-800'} mt-0.5">${this.e(v)}</p></div>`;
        const taCrit = criticas.some(a => a.campo === 'ta');
        return `<div class="grid grid-cols-5 gap-1.5 max-w-sm">${caja('TA', r.ta, taCrit)}${caja('FC', r.fc, criticas.some(a => a.campo === 'fc'))}${caja('FR', r.fr, criticas.some(a => a.campo === 'fr'))}${caja('Temp', r.temp, criticas.some(a => a.campo === 'temp'))}${caja('SpO2', r.spo2 + '%', criticas.some(a => a.campo === 'spo2'))}</div>${badgeAlerta}`;
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
                ${this.htmlPanelEstupefacientes('OBSERVACION')}${aviso}<div class="flex flex-wrap gap-2 mb-6">${chips}</div>${secciones}`;
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
            ${BelenStore.permisoAccionDe(this.sesion.usuario_id, 'cargar_consumos') ? `<button type="button" onclick="AdminController.abrirTerminalEstudios('${id}')" class="bg-cyan-700 hover:bg-cyan-800 text-white text-xs font-extrabold py-2.5 px-3 rounded-lg shadow-sm">🧪 Cargar Estudios / Tubos / Procedimientos</button>` : ''}
            ${(this.rolActual === 'admin' || this.rolActual === 'administrador') ? (t.liberado_a_caja ? `<button type="button" onclick="AdminController.abrirDesgloseCuenta('${id}')" class="bg-amber-600 hover:bg-amber-700 text-white text-xs font-extrabold py-2 px-3 rounded-lg shadow-sm flex items-center gap-1"><i class="fas fa-cash-register"></i> En Caja · Cobrar</button>` : `<button type="button" onclick="AdminController.liberarPreCobroFila('${id}')" class="bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 text-xs font-extrabold py-2 px-3 rounded-lg transition flex items-center gap-1"><i class="fas fa-cash-register"></i> Pasar a Caja (Pre-cobro)</button>`) : ''}
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
        const listos = espera.filter(t => t.estatus === 'listo_para_medico' || t.pase_por_rol || S.signosCompletos(t.signos_vitales));
        const sinSignosEspera = espera.filter(t => !S.signosCompletos(t.signos_vitales));
        const avisoGrande = (!enConsulta.length && espera.length) ? `<div id="aviso-paciente-listo" class="mb-6 rounded-2xl border-2 border-cyan-300 bg-cyan-50 px-5 py-4 shadow-sm flex flex-wrap items-center justify-between gap-4"><div class="flex items-center gap-3"><i class="fas fa-user-clock text-2xl text-cyan-700"></i><div><p class="text-base font-extrabold text-cyan-950">Tiene ${espera.length} ${espera.length === 1 ? 'paciente esperando' : 'pacientes en fila de espera'}</p><p class="text-xs text-cyan-800">${listos.length ? '✓ ' + listos.length + ' con signos vitales de Triage listos.' : ''}${sinSignosEspera.length ? (listos.length ? ' · ' : '') + sinSignosEspera.length + ' pendiente(s) de Triage (puede pasarlos directo y capturar signos dentro de la consulta).' : ''}</p></div></div></div>` : '';

        const tarjetaConsulta = t => {
            const id = this.e(t.turno_id);
            const porEnfermeria = !!t.pase_por_rol && t.pase_por_rol !== 'medico';
            const quienEnvio = String(t.pase_por_rol || '').indexOf('enf') === 0 ? 'Enfermería' : 'Recepción';
            const sinSignos = !S.signosCompletos(t.signos_vitales);
            return `<div data-turno="${id}" data-destacado="1" class="bg-emerald-50 rounded-2xl border-2 border-emerald-400 shadow-md p-5 ring-4 ring-emerald-100">
                <div class="flex flex-wrap items-start gap-4">
                    ${this.htmlTurnoCaja(t)}
                    <div class="flex-1 min-w-[200px]">
                        <div class="flex flex-wrap items-center gap-2 mb-1">
                            <span class="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase text-emerald-800 bg-emerald-200/70 rounded px-2 py-0.5"><span class="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse"></span> ${porEnfermeria ? quienEnvio + ' le envió este paciente' : 'Paciente listo en consulta'}</span>
                            ${sinSignos
                                ? '<span class="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase text-amber-800 bg-amber-100 border border-amber-300 rounded px-2 py-0.5"><i class="fas fa-triangle-exclamation"></i> Sin signos de Triage (capturar en consulta)</span>'
                                : '<span class="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase text-emerald-800 bg-white border border-emerald-300 rounded px-2 py-0.5"><i class="fas fa-check-circle text-emerald-600"></i> Signos vitales de Triage listos</span>'}
                        </div>
                        <h3 class="text-xl font-extrabold text-slate-900">${this.e(t.paciente_nombre)}</h3>
                        <p class="text-xs text-slate-500">${this.e(this.edadTexto(t))}${porEnfermeria && t.pase_por ? ' · Pasó: ' + this.e(t.pase_por) : ''}</p>
                        <p class="text-sm text-slate-700 mt-2"><span class="text-[10px] uppercase text-slate-400 font-bold">Motivo:</span> ${this.e(t.motivo)}</p>
                    </div>
                    <p class="text-[10px] uppercase text-slate-400 font-bold text-right leading-none">Esperó<br><span class="text-lg">${this.htmlReloj(t)}</span></p>
                </div>
                <div class="flex flex-wrap items-center justify-between gap-3 border-t border-emerald-200 pt-3 mt-3">
                    <div>${this.htmlSignos(t)}${sinSignos ? '<p class="text-[11px] font-semibold text-amber-800 mt-1">⚠️ Pase directo sin Triage: capturará los signos vitales dentro de la consulta.</p>' : ''}</div>
                    <a href="expediente.html?turno=${encodeURIComponent(t.turno_id)}" data-accion="entrar" class="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-3 rounded-xl text-sm font-extrabold shadow-md transition flex items-center gap-2"><i class="fas fa-file-medical"></i> Entrar a Consulta</a>
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

        return avisoGrande + `<div class="flex flex-wrap justify-between items-end gap-4 mb-8">
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
        const fichasHosp = hosp.map(t => S.fichaHospitalizado(t, this.sesion));
        const proximas = verCirugias ? S.cirugiasVisibles(this.sesion).slice(0, 3) : [];
        const mock = `<div class="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-8">
            <div class="${verCirugias ? 'lg:col-span-6' : 'lg:col-span-12'} flex flex-col gap-4">
                <div class="flex items-center justify-between">
                    <h3 class="text-lg font-bold text-slate-800 flex items-center gap-2"><i class="fas fa-bed-pulse text-indigo-600"></i> Pacientes en Cama (${fichasHosp.length})</h3>
                    <a href="?vista=hospitalizacion" onclick="AdminController.navegar('hospitalizacion', event)" class="text-xs font-bold text-indigo-700 hover:text-indigo-900">Ir al Monitor de Camas <i class="fas fa-arrow-right ml-1"></i></a>
                </div>
                ${fichasHosp.length ? fichasHosp.map(f => `
                    <div class="bg-white p-4 rounded-2xl shadow-sm border-l-4 border-l-indigo-600 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-slate-200">
                        <div>
                            <div class="flex flex-wrap items-center gap-1.5 mb-1">
                                <span class="text-[10px] font-extrabold uppercase tracking-wider bg-indigo-600 text-white px-2 py-0.5 rounded">${this.e(f.cama || 'Sin cama')}</span>
                                <span class="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 px-2 py-0.5 rounded">${this.e(f.area || 'Hospitalización')}</span>
                            </div>
                            <h4 class="text-base font-extrabold text-slate-900">${this.e(f.nombre)}</h4>
                            <p class="text-xs text-slate-600 font-medium">${this.e(f.especialidad || '')} • <span class="text-slate-500">${this.e(f.medico_tratante || '')}</span></p>
                        </div>
                        <div class="flex flex-wrap items-center gap-2">
                            <a href="expediente.html?modo=hospitalizado&turno=${encodeURIComponent(f.turno_id)}" class="bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold py-2 px-3.5 rounded-xl transition flex items-center gap-1.5"><i class="fas fa-folder-open"></i> Abrir Expediente</a>
                            <button type="button" onclick="AdminController.abrirDesgloseCuenta('${this.e(f.turno_id)}')" class="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold py-2 px-3 rounded-xl transition"><i class="fas fa-receipt mr-1"></i> Cuenta</button>
                        </div>
                    </div>`).join('') : '<p class="text-sm text-slate-400 bg-white border border-dashed border-slate-300 rounded-xl p-5 text-center">No hay pacientes hospitalizados en este momento.</p>'}
            </div>
            ${verCirugias ? `<div class="lg:col-span-6 flex flex-col gap-3">
                <div class="flex items-center justify-between">
                    <h3 class="text-lg font-bold text-slate-800 flex items-center gap-2"><i class="fas fa-kit-medical text-violet-600"></i> Próximas Cirugías</h3>
                    <a href="?vista=cirugias" onclick="AdminController.navegar('cirugias', event)" class="text-xs font-bold text-cyan-700 hover:text-cyan-900">Ver todas <i class="fas fa-arrow-right ml-1"></i></a></div>
                ${proximas.length ? proximas.map(c => this.htmlTarjetaCirugia(c)).join('') : '<p class="text-sm text-slate-400 bg-white border border-dashed border-slate-300 rounded-xl p-5 text-center">No hay cirugías programadas.</p>'}
            </div>` : ''}</div>`;

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
    colorCirujanoCalendario: function (medicoId, confirmadaAdmin) {
        const paletas = {
            dr_arturo:     { nombre: 'Dr. Arturo Gómez (Cirugía Gral.)',      dot: 'bg-blue-600',    borde: 'border-l-blue-600',    chip: 'bg-blue-50 hover:bg-blue-100 text-blue-950 border-l-4 border-blue-600',       badge: 'bg-blue-100 text-blue-900 border-blue-300' },
            dra_patricia:  { nombre: 'Dra. Patricia Gómez (Gineco-Obst.)',    dot: 'bg-pink-600',    borde: 'border-l-pink-600',    chip: 'bg-pink-50 hover:bg-pink-100 text-pink-950 border-l-4 border-pink-600',       badge: 'bg-pink-100 text-pink-900 border-pink-300' },
            dr_roberto:    { nombre: 'Dr. Roberto Flores (Angiología)',       dot: 'bg-emerald-600', borde: 'border-l-emerald-600', chip: 'bg-emerald-50 hover:bg-emerald-100 text-emerald-950 border-l-4 border-emerald-600', badge: 'bg-emerald-100 text-emerald-900 border-emerald-300' },
            dr_juan:       { nombre: 'Dr. Juan Pérez (Medicina Gral.)',       dot: 'bg-indigo-600',  borde: 'border-l-indigo-600',  chip: 'bg-indigo-50 hover:bg-indigo-100 text-indigo-950 border-l-4 border-indigo-600',   badge: 'bg-indigo-100 text-indigo-900 border-indigo-300' },
            dr_internista: { nombre: 'Dr. Daniel Morales (Med. Interna)',     dot: 'bg-cyan-600',    borde: 'border-l-cyan-600',    chip: 'bg-cyan-50 hover:bg-cyan-100 text-cyan-950 border-l-4 border-cyan-600',       badge: 'bg-cyan-100 text-cyan-900 border-cyan-300' }
        };
        const base = paletas[medicoId] || { nombre: 'Otro Cirujano', dot: 'bg-violet-600', borde: 'border-l-violet-600', chip: 'bg-violet-50 hover:bg-violet-100 text-violet-950 border-l-4 border-violet-600', badge: 'bg-violet-100 text-violet-900 border-violet-300' };
        if (!confirmadaAdmin) {
            return {
                nombre: base.nombre,
                dot: 'bg-amber-500',
                borde: 'border-l-amber-500',
                chip: 'bg-amber-50 hover:bg-amber-100 text-amber-950 border-l-4 border-amber-500 ring-1 ring-amber-300',
                badge: 'bg-amber-100 text-amber-900 border-amber-300'
            };
        }
        return base;
    },

    htmlTarjetaCirugia: function (c) {
        const e = t => this.e(t);
        const S = BelenStore;
        const d = new Date(c.fecha_hora), hoy = new Date();
        const dias = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())) / 86400000);
        const cuando = dias === 0 ? ['Hoy', 'bg-red-100 text-red-700'] : (dias === 1 ? ['Mañana', 'bg-amber-100 text-amber-700'] : (dias > 1 ? ['En ' + dias + ' días', 'bg-slate-100 text-slate-600'] : ['En curso', 'bg-violet-100 text-violet-700']));
        const dato = (et, v) => `<div class="min-w-0"><p class="text-[10px] font-bold text-slate-400 uppercase leading-none">${et}</p><p class="text-sm text-slate-800 mt-1 leading-snug">${v}</p></div>`;
        const col = this.colorCirujanoCalendario(c.medico_cirujano_id, c.confirmada_admin);
        const tipo = c.tipo_estancia === 'AMBULATORIA'
            ? '<span class="inline-flex text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-violet-600 text-cyan-50 border border-cyan-300">Ambulatoria</span>'
            : '<span class="inline-flex text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">Hospitalaria</span>';
        const anestesia = c.anestesiologo
            ? `<span class="font-semibold" data-campo="anestesiologo">${e(c.anestesiologo)}</span>`
            : '<span class="font-extrabold text-amber-700" data-campo="anestesiologo">Pendiente (Asignará Administración)</span>';
        const esAdmin = this.rolActual === 'admin' || this.rolActual === 'administrador';
        const btnDetalle = `<button type="button" onclick="AdminController.abrirDetalleCirugiaCalendario('${e(c.cirugia_id)}')" class="${esAdmin ? (c.confirmada_admin ? 'bg-slate-800 hover:bg-slate-900' : 'bg-amber-600 hover:bg-amber-700') : 'bg-violet-700 hover:bg-violet-800'} text-white text-xs font-extrabold py-2.5 px-3 rounded-lg shadow-sm"><i class="fas ${esAdmin ? 'fa-user-check' : 'fa-calendar-check'} mr-1"></i>${esAdmin ? (c.confirmada_admin ? 'Ver / Editar Equipo y Autorización' : 'Revisar, Asignar Equipo y Autorizar') : 'Ver Horario, Equipo e Indicaciones'}</button>`;
        const badgeConfirmada = c.confirmada_admin
            ? `<span class="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300"><i class="fas fa-circle-check"></i> Autorizada por Administración</span>`
            : `<span class="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300"><i class="fas fa-clock"></i> Pendiente de confirmación por Administración</span>`;
        const avisoMedicoPendiente = (!c.confirmada_admin && this.rolActual === 'medico')
            ? `<div class="mt-2.5 bg-amber-50 border border-amber-300 text-amber-900 rounded-xl px-3 py-2 text-xs font-bold flex items-center gap-2"><i class="fas fa-hourglass-half text-amber-600"></i><span>Falta la confirmación de esta programación por Administración (Alfonso).</span></div>`
            : '';
        const equipoExtra = (c.ayudante_nombre || c.instrumentista_nombre || c.circulante_nombre)
            ? `<div class="col-span-2 pt-2 border-t border-slate-100 text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
                ${c.ayudante_nombre ? `<span><b class="text-slate-500 uppercase text-[10px]">1er Ayudante:</b> ${e(c.ayudante_nombre)}</span>` : ''}
                ${c.instrumentista_nombre ? `<span><b class="text-slate-500 uppercase text-[10px]">Instrumentista:</b> ${e(c.instrumentista_nombre)}</span>` : ''}
                ${c.circulante_nombre ? `<span><b class="text-slate-500 uppercase text-[10px]">Circulante:</b> ${e(c.circulante_nombre)}</span>` : ''}
            </div>` : '';
        const ingresar = S.puedeIngresarAmbulatorio(this.sesion) && c.tipo_estancia === 'AMBULATORIA' && !c.ingresada && !c.ya_internado
            ? `<button type="button" onclick="AdminController.confirmarIngresoAmbulatorio('${e(c.cirugia_id)}')" class="bg-cyan-700 hover:bg-cyan-800 text-white text-xs font-extrabold py-2.5 px-3 rounded-lg shadow-sm">1. Ingresar Paciente Ambulatorio a Quirófano</button>` : '';
        const turnoQx = S.turnoActivoParaEstudios({ turno_id: c.turno_id, paciente_id: c.paciente_id });
        const cargarQx = turnoQx && S.permisoAccionDe(this.sesion.usuario_id, 'cargar_consumos')
            ? `<button type="button" onclick="AdminController.abrirTerminalEstudios('${e(turnoQx.turno_id)}')" class="bg-cyan-700 hover:bg-cyan-800 text-white text-xs font-extrabold py-2.5 px-3 rounded-lg shadow-sm">🧪 Cargar Estudios / Tubos / Procedimientos</button>` : '';
        const postopQx = turnoQx && S.puedeNotaPostoperatoria(this.sesion, S.internamientoDeTurno(turnoQx.turno_id))
            ? `<button type="button" onclick="AdminController.abrirNotaPostoperatoria('${e(turnoQx.turno_id)}')" class="bg-violet-700 hover:bg-violet-800 text-white text-xs font-extrabold py-2.5 px-3 rounded-lg shadow-sm">Nota Post-Operatoria</button>` : '';
        const abrirExp = c.turno_id
            ? `<a href="expediente.html?modo=hospitalizado&turno=${encodeURIComponent(c.turno_id)}" class="bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold py-2.5 px-3 rounded-lg shadow-sm">Abrir expediente</a>`
            : '';
        const ya = c.ingresada
            ? '<span class="inline-flex text-[10px] font-extrabold uppercase px-2 py-1 rounded-full bg-violet-600 text-cyan-50 border border-cyan-300">CIRUGÍA AMBULATORIA · ingresado</span>'
            : (c.ya_internado && c.tipo_estancia === 'AMBULATORIA' ? '<span class="text-[11px] font-semibold text-slate-500">El paciente ya tiene un episodio activo.</span>' : '');
        return `<div data-cirugia="${e(c.cirugia_id)}" class="bg-white rounded-2xl border border-slate-200 border-l-4 ${col.borde} shadow-sm p-4">
            <div class="flex flex-wrap items-start justify-between gap-2">
                <div class="min-w-0"><div class="flex flex-wrap items-center gap-2 mb-1">${tipo}${badgeConfirmada}</div>
                    <h4 class="text-base font-extrabold text-slate-900" data-campo="paciente">${e(c.nombre)}</h4>
                    <p class="text-sm font-semibold text-violet-700 mt-0.5" data-campo="procedimiento"><i class="fas fa-kit-medical mr-1 text-xs"></i>${e(c.procedimiento)}</p>
                    <p class="text-[11px] text-slate-500 mt-1" data-campo="sala">${e(c.sala_nombre || '')}</p></div>
                <div class="text-right shrink-0"><span class="inline-block text-[10px] font-bold uppercase px-2 py-0.5 rounded ${cuando[1]}">${cuando[0]}</span>
                    <p class="text-sm font-bold text-slate-800 mt-1" data-campo="fecha">${e((c.fecha_texto || '').charAt(0).toUpperCase() + (c.fecha_texto || '').slice(1))}</p>
                    <p class="text-lg font-extrabold text-slate-900 leading-none" data-campo="hora">${e(c.hora_texto)}</p>
                    ${c.duracion_texto ? `<p class="text-[11px] text-slate-400">${e(c.duracion_texto)}</p>` : ''}</div>
            </div>
            ${avisoMedicoPendiente}
            <div class="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-slate-100">
                ${dato('Fecha de nacimiento', `<span data-campo="nacimiento">${e(S.fechaLegibleISO(c.fecha_nacimiento))}</span>`)}
                ${dato('Edad', `<span data-campo="edad">${S.formatearEdad ? S.formatearEdad(c.fecha_nacimiento, c.edad) : (c.edad !== null ? c.edad + ' años' : '—')}</span>`)}
                ${dato('Médico cirujano', `<span class="inline-flex items-center gap-1.5 font-semibold" data-campo="cirujano"><span class="w-2.5 h-2.5 rounded-full ${col.dot}"></span>${e(c.medico_cirujano)}</span>${c.medico_especialidad ? `<span class="block text-[11px] text-slate-400">${e(c.medico_especialidad)}</span>` : ''}`)}
                ${dato('Anestesiólogo', anestesia)}
                ${equipoExtra}
            </div>
            <div class="mt-3 bg-cyan-50 border border-cyan-200 rounded-lg px-3 py-2">
                <p class="text-[10px] font-bold text-cyan-800 uppercase leading-none mb-1"><i class="fas fa-clipboard-list mr-1"></i>Indicaciones preoperatorias</p>
                <p class="text-xs text-slate-800" data-campo="indicaciones">${c.indicaciones_preoperatorias ? e(c.indicaciones_preoperatorias) : '<span class="text-slate-400 italic">Sin indicaciones preoperatorias.</span>'}</p></div>
            <div class="mt-2 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
                <p class="text-[10px] font-bold text-yellow-700 uppercase leading-none mb-1"><i class="fas fa-note-sticky mr-1"></i>Notas privadas</p>
                <p class="text-xs text-slate-800" data-campo="notas">${c.notas ? e(c.notas) : '<span class="text-slate-400 italic">Sin notas registradas.</span>'}</p></div>
            <div class="mt-3 flex flex-wrap items-center gap-2">${btnDetalle}${cargarQx}${postopQx}${ingresar}${abrirExp}${ya}</div>
        </div>`;
    },

    htmlCirugias: function () {
        const S = BelenStore;
        if (S.sincronizarPaseAutomaticoQuirofano) S.sincronizarPaseAutomaticoQuirofano();
        const lista = S.cirugiasVisibles(this.sesion);
        const listaFiltrada = this.diaFiltroQx ? lista.filter(c => (c.fecha || String(c.fecha_hora || '').slice(0, 10)) === this.diaFiltroQx) : lista;
        const boton = S.puede('programar_cirugia')
            ? `<button type="button" id="btn-programar-cirugia" onclick="AdminController.abrirProgramarCirugia()" class="bg-violet-600 hover:bg-violet-700 text-white font-bold py-3 px-6 rounded-xl shadow-md hover:-translate-y-0.5 transition-all flex items-center gap-2"><i class="fas fa-plus-circle"></i> + Programar Cirugía</button>` : '';
        const aviso = this.sesion.especialidad_codigo === 'ANESTESIOLOGIA'
            ? 'Solo aparecen las cirugías en las que usted está asignado como anestesiólogo.'
            : (this.rolActual === 'medico'
                ? 'Solo aparecen sus cirugías y aquellas en las que está interconsultado. Las de otros médicos permanecen ocultas.'
                : (this.rolActual === 'enf_hospital'
                    ? 'Se muestran las cirugías de los pacientes que ya están a su cargo en hospitalización.'
                    : (this.rolActual === 'enf_quirofano'
                        ? 'Enfermería de Quirófano: agenda mensual completa de Quirófano Grande y Quirófano Chico. Toque cualquier cirugía para ver horas, equipo e indicaciones.'
                        : 'Administración (Alfonso): toque cualquier cirugía en el calendario para asignar equipo, autorizar o rechazar.')));
        const pendientesMedico = this.rolActual === 'medico' ? lista.filter(c => !c.confirmada_admin) : [];
        const bannerMedico = pendientesMedico.length
            ? `<div class="mb-4 bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
                <div class="flex items-center gap-3">
                    <span class="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center text-lg font-bold shrink-0"><i class="fas fa-clock"></i></span>
                    <div>
                        <p class="text-sm font-extrabold text-amber-950">Falta confirmación de la programación por Administración (${pendientesMedico.length} ${pendientesMedico.length === 1 ? 'cirugía' : 'cirugías'})</p>
                        <p class="text-xs text-amber-800">Su solicitud ya está en la agenda de Quirófano. Administración (Alfonso) confirmará la sala y asignará anestesiólogo, ayudante, instrumentista y circulante.</p>
                    </div>
                </div>
            </div>` : '';
        const barraFiltroDia = this.diaFiltroQx
            ? `<div class="mb-4 flex items-center justify-between bg-violet-50 border border-violet-200 rounded-xl px-4 py-2.5 text-xs">
                <span class="font-bold text-violet-900"><i class="fas fa-filter mr-1.5"></i>Mostrando cirugías del día <b>${this.e(S.fechaLegibleISO(this.diaFiltroQx))}</b> (${listaFiltrada.length})</span>
                <button type="button" onclick="AdminController.seleccionarDiaCalendarioQx('')" class="bg-violet-700 hover:bg-violet-800 text-white font-extrabold px-3 py-1 rounded-lg">Ver todas las fechas (${lista.length})</button>
            </div>` : '';
        return `<div class="flex flex-wrap justify-between items-end gap-4 mb-6">
                    <div><h2 class="text-2xl font-extrabold text-slate-800">Agenda y Calendario de Quirófano</h2><p class="text-slate-500">${this.e(aviso)}</p></div>${boton}</div>
                ${bannerMedico}
                ${this.htmlPanelEstupefacientes('QUIROFANO')}
                ${this.htmlCalendarioQuirofano(lista)}
                ${this.htmlControlesQuirofano(lista)}
                ${barraFiltroDia}
                <div id="lista-cirugias" class="grid grid-cols-1 xl:grid-cols-2 gap-4">${listaFiltrada.length ? listaFiltrada.map(c => this.htmlTarjetaCirugia(c)).join('') : '<div class="xl:col-span-2 text-center py-16 text-slate-400 font-medium bg-white/60 rounded-2xl border border-dashed border-slate-300"><i class="fas fa-kit-medical text-4xl mb-3 text-slate-300"></i><p>No hay cirugías programadas para este filtro.</p></div>'}</div>`;
    },

    pintarDisponibilidadQx: function (raiz) {
        const S = BelenStore, e = t => this.e(t);
        const box = raiz.querySelector('#cx-disponibilidad');
        const sala = raiz.querySelector('#cx-sala').value, fecha = raiz.querySelector('#cx-fecha').value;
        if (!sala || !fecha) { box.classList.add('hidden'); box.innerHTML = ''; return; }
        const d = S.disponibilidadQuirofano(sala, fecha, this.sesion);
        if (!d.ok) { box.classList.add('hidden'); return; }
        box.classList.remove('hidden');
        const seg = t => {
            const cls = t.tipo === 'libre' ? 'bg-emerald-500' : (t.tipo === 'ocupado' ? 'bg-rose-500' : 'bg-slate-300');
            return `<div class="${cls} h-9 min-w-[4px]" style="width:${t.porcentaje}%" title="${e(t.etiqueta)}"></div>`;
        };
        const libres = (d.libres || []).map(t => `<button type="button" data-libre="${e(t.inicio)}" class="text-left text-xs font-bold text-emerald-900 bg-emerald-50 border border-emerald-300 rounded-lg px-3 py-2 hover:bg-emerald-100">Libre: ${e(t.inicio)} - ${e(t.fin)}</button>`).join('');
        const ocupados = (d.ocupados || []).map(t => `<div class="text-xs font-bold text-rose-900 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">${e(t.etiqueta)}</div>`).join('');
        box.innerHTML = `<p class="text-[11px] font-bold text-slate-500 uppercase mb-2">Disponibilidad del día · 07:00 a 22:00</p>
            <div class="flex w-full rounded-lg overflow-hidden border border-slate-200 mb-2">${(d.tramos || []).map(seg).join('')}</div>
            <div class="flex flex-col gap-1.5">${libres}${ocupados || '<p class="text-xs text-emerald-700">Toda la jornada está libre en esta sala.</p>'}</div>
            <p class="text-[11px] text-slate-400 mt-1">Toque un tramo libre para usarlo como hora de inicio.</p>`;
        box.querySelectorAll('[data-libre]').forEach(b => b.addEventListener('click', () => {
            raiz.querySelector('#cx-hora_inicio').value = b.getAttribute('data-libre');
            this.actualizarHoraFinQx(raiz);
        }));
    },
    actualizarHoraFinQx: function (raiz) {
        const ini = raiz.querySelector('#cx-hora_inicio').value;
        const dur = Number(raiz.querySelector('#cx-duracion').value);
        const out = raiz.querySelector('#cx-hora_fin');
        const m = String(ini || '').match(/^(\d{2}):(\d{2})$/);
        if (!m || !dur) { out.value = ''; return; }
        const total = (+m[1]) * 60 + (+m[2]) + dur;
        out.value = total >= 24 * 60 ? 'Pasa de medianoche' : String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
    },
    abrirProgramarCirugia: function (preset) {
        const S = BelenStore;
        preset = preset && preset.paciente_id ? preset : {};
        if (!S.puede('programar_cirugia')) { BelenUI.toast('Su perfil no puede programar cirugías.', 'alerta'); return; }
        const cls = 'w-full border border-slate-300 rounded-lg p-2.5 text-sm text-slate-800 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none bg-white';
        const err = k => `<p data-err="${k}" class="text-[11px] text-red-600 mt-1 hidden"></p>`;
        const lab = (id, t, req) => `<label for="${id}" class="block text-[11px] font-bold text-slate-500 uppercase mb-1">${t}${req ? ' <span class="text-red-500">*</span>' : ''}</label>`;
        const propio = this.rolActual === 'medico' && S.cirujanos().some(m => m.id === this.sesion.medico_id);
        const listaCirujanos = propio ? S.cirujanos().filter(m => m.id === this.sesion.medico_id) : S.cirujanos();
        const medicos = listaCirujanos.map(m => `<option value="${m.id}" ${propio || preset.medico_id === m.id ? 'selected' : ''}>${this.e(m.nombre)} · ${this.e(m.cargo)}</option>`).join('');
        const anests = S.anestesiologos().map(m => `<option value="${m.id}">${this.e(m.nombre)} · ${this.e(m.cargo)}</option>`).join('');
        const salas = S.SALAS_QUIROFANO.map(x => `<option value="${x.codigo}">${this.e(x.nombre)}</option>`).join('');
        const tipos = S.TIPOS_ESTANCIA_QX.map(x => `<option value="${x.codigo}">${this.e(x.etiqueta)}</option>`).join('');
        const duraciones = S.DURACIONES_CIRUGIA.map(x => `<option value="${x.minutos}">${this.e(x.etiqueta)}</option>`).join('');
        const bloqueado = !!preset.paciente_id;
        const pacPreset = bloqueado ? (S.buscarPacientePorId(preset.paciente_id) || {}) : {};
        const partesPreset = S.partesDeNombre(pacPreset.nombre_completo ? pacPreset : { nombre_completo: preset.nombre || '' });
        const self = this;
        BelenUI.modal({
            titulo: 'Programar Cirugía', subtitulo: bloqueado ? 'Paciente ya internado. La cirugía queda en la agenda de la sala elegida.' : 'Busque al paciente o capture uno que todavía no esté en el catálogo.', icono: 'fa-kit-medical', ancho: 'xl',
            html: `<div class="grid grid-cols-1 sm:grid-cols-6 gap-4">
                <input id="cx-paciente_id" type="hidden" value="${this.e(preset.paciente_id || '')}">
                ${BelenUI.htmlIdentidadPaciente({ prefijo: 'cx', cls: cls, bloquear: bloqueado, sugerencias: !bloqueado, autofoco: !bloqueado, valores: { nombres: partesPreset.nombres, apellido_paterno: partesPreset.apellido_paterno, apellido_materno: partesPreset.apellido_materno, fecha_nacimiento: pacPreset.fecha_nacimiento || preset.fecha_nacimiento || '', sexo: pacPreset.sexo || '', telefono: pacPreset.telefono || '', direccion: pacPreset.direccion || '' } })}
                <div class="sm:col-span-3">${lab('cx-edad', 'Edad')}<input id="cx-edad" type="text" readonly tabindex="-1" placeholder="Se calcula sola" class="${cls} bg-slate-50 text-slate-500"></div>
                <div class="sm:col-span-6">${lab('cx-tipo_estancia', 'Tipo de estancia quirúrgica', true)}<select id="cx-tipo_estancia" class="${cls}"><option value="">Seleccione…</option>${tipos}</select>${err('tipo_estancia')}</div>
                <div class="sm:col-span-6">${lab('cx-procedimiento', 'Nombre de la cirugía', true)}<input id="cx-procedimiento" type="text" maxlength="120" placeholder="Ej. Colecistectomía laparoscópica" class="${cls}">${err('procedimiento')}</div>
                <div class="sm:col-span-6">${lab('cx-sala', 'Sala solicitada', true)}<select id="cx-sala" class="${cls}"><option value="">Seleccione…</option>${salas}</select>${err('sala')}</div>
                <div class="sm:col-span-6">${lab('cx-fecha', 'Fecha de la cirugía', true)}<input id="cx-fecha" type="date" min="${S.hoyLocal()}" class="${cls}">${err('fecha')}</div>
                <div id="cx-disponibilidad" class="sm:col-span-6 hidden"></div>
                <div class="sm:col-span-2">${lab('cx-hora_inicio', 'Hora de inicio', true)}<input id="cx-hora_inicio" type="time" min="07:00" max="21:30" step="300" class="${cls}">${err('hora_inicio')}</div>
                <div class="sm:col-span-2">${lab('cx-duracion', 'Duración estimada', true)}<select id="cx-duracion" class="${cls}"><option value="">Seleccione…</option>${duraciones}</select>${err('duracion_minutos')}</div>
                <div class="sm:col-span-2">${lab('cx-hora_fin', 'Hora de fin')}<input id="cx-hora_fin" type="text" readonly tabindex="-1" placeholder="Se calcula sola" class="${cls} bg-slate-50 text-slate-500"></div>
                <div class="sm:col-span-3">${lab('cx-medico_cirujano_id', 'Médico cirujano', true)}<select id="cx-medico_cirujano_id" class="${cls}" ${propio ? 'disabled' : ''}><option value="">Seleccione…</option>${medicos}</select>${err('medico_cirujano_id')}</div>
                <div class="sm:col-span-3">${lab('cx-anestesiologo_id', 'Anestesiólogo')}<select id="cx-anestesiologo_id" class="${cls}"><option value="">Pendiente (Asignará Administración)</option>${anests}</select>${err('anestesiologo_id')}</div>
                <div class="sm:col-span-6">${lab('cx-indicaciones', 'Indicaciones preoperatorias')}<textarea id="cx-indicaciones" rows="2" maxlength="600" placeholder="Ej. ayuno de 8 hrs, tricotomía, laboratorios previos" class="${cls} resize-none"></textarea>${err('indicaciones_preoperatorias')}</div>
                <div class="sm:col-span-6">${lab('cx-notas', 'Notas privadas')}<textarea id="cx-notas" rows="2" maxlength="600" placeholder="Notas que no salen en la indicación preoperatoria" class="${cls} resize-none"></textarea>${err('notas')}</div>
            </div>`,
            alMostrar: c => {
                const q = sel => c.el.querySelector(sel);
                const fn = q('#cx-fn'), ed = q('#cx-edad');
                const calc = () => { const txt = S.formatearEdad ? S.formatearEdad(fn.value) : ''; ed.value = txt || ''; };
                fn.addEventListener('input', calc); fn.addEventListener('change', calc); calc();
                const refrescar = () => self.pintarDisponibilidadQx(c.el);
                q('#cx-sala').addEventListener('change', refrescar);
                q('#cx-fecha').addEventListener('change', refrescar);
                const fin = () => self.actualizarHoraFinQx(c.el);
                q('#cx-hora_inicio').addEventListener('input', fin);
                q('#cx-duracion').addEventListener('change', fin);
                const sugerir = () => {
                    const caja = q('#cx-sugerencias');
                    if (!caja) return;
                    const idn = BelenUI.leerIdentidadPaciente(c.el, 'cx');
                    const lista = q('#cx-paciente_id').value ? [] : S.buscarPacientesPorNombre(idn.nombre_completo, 6);
                    caja.innerHTML = lista.map(p => `<button type="button" data-pac="${self.e(p.paciente_id)}" class="text-left text-xs bg-white border border-slate-200 rounded-lg px-3 py-2 hover:border-violet-400"><b>${self.e(p.nombre_completo)}</b><span class="block text-slate-400">${self.e(S.fechaLegibleISO(p.fecha_nacimiento))} · ${S.formatearEdad ? (S.formatearEdad(p.fecha_nacimiento) || 'Edad no registrada') : (S.calcularEdad(p.fecha_nacimiento) === null ? 'Edad no registrada' : S.calcularEdad(p.fecha_nacimiento) + ' años')}</span></button>`).join('');
                    caja.querySelectorAll('[data-pac]').forEach(b => b.addEventListener('click', () => {
                        const p = S.buscarPacientePorId(b.getAttribute('data-pac'));
                        if (!p) return;
                        q('#cx-paciente_id').value = p.paciente_id;
                        self.llenarIdentidad(c.el, 'cx', p);
                        caja.innerHTML = '';
                        calc();
                    }));
                };
                ['cx-nombres', 'cx-paterno', 'cx-materno'].forEach(id => { const n = q('#' + id); if (n) n.addEventListener('input', () => { q('#cx-paciente_id').value = ''; sugerir(); }); });
                c.el.querySelectorAll('input,select,textarea').forEach(i => i.addEventListener('input', () => {
                    const clave = i.id === 'cx-duracion' ? 'duracion_minutos' : (i.id === 'cx-indicaciones' ? 'indicaciones_preoperatorias' : i.id.replace('cx-', ''));
                    const p = c.el.querySelector(`[data-err="${clave}"]`); if (p) p.classList.add('hidden'); i.classList.remove('border-red-500');
                }));
            },
            botones: [
                { texto: 'Cancelar', estilo: 'secundario' },
                { texto: 'Guardar Cirugía', estilo: 'primario', id: 'cx-guardar', alPulsar: c => {
                    const q = sel => c.el.querySelector(sel);
                    const idn = BelenUI.leerIdentidadPaciente(c.el, 'cx');
                    const r = S.programarCirugia({
                        paciente_id: q('#cx-paciente_id').value, nombre: idn.nombre_completo, nombres: idn.nombres, apellido_paterno: idn.apellido_paterno, apellido_materno: idn.apellido_materno,
                        fecha_nacimiento: idn.fecha_nacimiento, sexo: idn.sexo, telefono: idn.telefono, direccion: idn.direccion,
                        tipo_estancia: q('#cx-tipo_estancia').value, procedimiento: q('#cx-procedimiento').value, sala: q('#cx-sala').value,
                        fecha: q('#cx-fecha').value, hora_inicio: q('#cx-hora_inicio').value, duracion_minutos: q('#cx-duracion').value,
                        medico_cirujano_id: q('#cx-medico_cirujano_id').value, anestesiologo_id: q('#cx-anestesiologo_id').value,
                        indicaciones_preoperatorias: q('#cx-indicaciones').value, notas: q('#cx-notas').value
                    }, this.sesion);
                    if (!r.ok) {
                        c.el.querySelectorAll('[data-err]').forEach(p => p.classList.add('hidden'));
                        Object.keys(r.errores || {}).forEach(k => {
                            const aliasErr = { telefono: 'tel', direccion: 'dir', fecha_nacimiento: 'fn', nombre: 'nombres' };
                            const p = q(`[data-err="${aliasErr[k] || k}"]`); if (p) { p.textContent = r.errores[k]; p.classList.remove('hidden'); }
                            const mapa = { duracion_minutos: 'cx-duracion', indicaciones_preoperatorias: 'cx-indicaciones', fecha_nacimiento: 'cx-fn', telefono: 'cx-tel', direccion: 'cx-dir', apellido_paterno: 'cx-paterno', apellido_materno: 'cx-materno', nombres: 'cx-nombres', sexo: 'cx-sexo', nombre: 'cx-nombres' };
                            const i = q('#' + (mapa[k] || ('cx-' + k))); if (i) i.classList.add('border-red-500');
                        });
                        if (!r.errores) BelenUI.toast(r.motivo, 'peligro');
                        return false;
                    }
                    const finTxt = r.cirugia.hora_inicio && r.cirugia.hora_fin ? ' (' + r.cirugia.hora_inicio + ' a ' + r.cirugia.hora_fin + ')' : '';
                    BelenUI.toast(r.cirugia.confirmada_admin ? ('Cirugía programada y confirmada: ' + r.cirugia.procedimiento + finTxt + '.') : ('Cirugía enviada a programación' + finTxt + '. Falta la confirmación por Administración (Alfonso).'), 'exito');
                    this.render();
                } }
            ]
        });
    },
    abrirAsignarAnestesiologo: function (cirugiaId) {
        const S = BelenStore, c = S.cirugiaPara(cirugiaId, this.sesion);
        if (!c || (this.rolActual !== 'admin' && this.rolActual !== 'administrador')) { BelenUI.toast('No puede asignar al anestesiólogo.', 'alerta'); return; }
        const anests = S.anestesiologos();
        if (!anests.length) { BelenUI.toast('No hay anestesiólogos activos.', 'alerta'); return; }
        BelenUI.modal({
            titulo: 'Asignar Anestesiólogo', subtitulo: c.procedimiento + ' · ' + c.hora_texto, icono: 'fa-user-doctor', ancho: 'sm',
            html: `<div class="flex flex-col gap-2">${anests.map(m => `<button type="button" data-an="${this.e(m.id)}" class="text-left px-3 py-3 rounded-xl border border-slate-200 hover:border-rose-400 hover:bg-rose-50"><span class="block font-extrabold text-slate-900">${this.e(m.nombre)}</span><span class="block text-xs text-slate-500">${this.e(m.cargo)}</span></button>`).join('')}</div>`,
            alMostrar: modal => modal.el.querySelectorAll('[data-an]').forEach(b => b.addEventListener('click', () => {
                const r = S.asignarAnestesiologo(cirugiaId, b.getAttribute('data-an'), this.sesion);
                if (!r.ok) { BelenUI.toast(r.motivo, 'alerta'); return; }
                modal.cerrar();
                BelenUI.toast('Anestesiólogo asignado: ' + r.cirugia.anestesiologo + '.', 'exito');
                this.render();
            })),
            botones: [{ texto: 'Cancelar', estilo: 'secundario' }]
        });
    },
    confirmarIngresoAmbulatorio: function (cirugiaId) {
        const S = BelenStore, c = S.cirugiaPara(cirugiaId, this.sesion);
        if (!c || !S.puedeIngresarAmbulatorio(this.sesion)) { BelenUI.toast('No puede ingresar a este paciente.', 'alerta'); return; }
        BelenUI.confirmar({
            titulo: '¿Ingresar a ' + c.nombre + ' a quirófano?',
            mensaje: 'Entra directo a Quirófano / Recuperación Ambulatoria. No pasa por la fila de consulta ni exige nota de consulta. Se habilitan su Hoja Frontal, sus Consentimientos y su Cuenta de Consumos, con las indicaciones preoperatorias ya cargadas.',
            textoConfirmar: 'Ingresar Paciente Ambulatorio',
            tipo: 'info', icono: 'fa-kit-medical', ancho: 'md',
            alConfirmar: () => {
                const r = S.ingresarPacienteAmbulatorio(cirugiaId, this.sesion);
                if (!r.ok) { BelenUI.toast(r.motivo, 'alerta'); return; }
                BelenUI.toast(c.nombre + ' quedó internado en quirófano ambulatorio.', 'exito');
                this.render();
            }
        });
    },

    verCuentaRapida: function (nombre, monto) {
        BelenUI.aviso('Pre-cuenta de ' + nombre, 'Cuenta actual: ' + monto.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }), 'info');
    },

    // ================= Parche Sanatorio Belén: costo de consulta, mini-paquetes, devoluciones, quirófano =================
    abrirCostoConsulta: function (usuarioId) {
        const S = BelenStore, u = S.USUARIOS[usuarioId];
        if (!u) return;
        const actual = u.costo_consulta != null ? u.costo_consulta : (u.especialidad_codigo === 'MEDICINA_GENERAL' ? 400 : 800);
        BelenUI.modal({
            titulo: 'Costo de consulta', subtitulo: u.nombre, icono: 'fa-money-bill', ancho: 'sm',
            html: '<label class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Precio de la consulta (MXN)</label><input id="cc-monto" type="number" min="0" step="1" value="' + this.e(actual) + '" class="w-full border border-slate-300 rounded-lg p-3 text-lg"><p id="cc-error" class="text-xs text-red-600 mt-1"></p>',
            botones: [{ texto: 'Cancelar', estilo: 'secundario' }, { texto: 'Guardar', estilo: 'exito', alPulsar: c => {
                const r = S.actualizarCostoConsultaMedico(usuarioId, c.el.querySelector('#cc-monto').value, this.sesion);
                if (r && r.ok === false) { c.el.querySelector('#cc-error').textContent = r.motivo || 'No se pudo guardar.'; return false; }
                BelenUI.toast('Costo de consulta actualizado.', 'exito'); this.render();
            } }]
        });
    },
    htmlMiniPaquetesTerminal: function () {
        const S = BelenStore, e = t => this.e(t);
        if (!this.operadorFarmacia() || this.modoRetiroAdmin) return '';
        const paqs = S.listarPaquetes();
        const crear = S.puede('gestionar_farmacia') ? '<button type="button" onclick="AdminController.abrirEditorPaquete()" class="px-3 py-2 rounded-lg border border-dashed border-teal-500 text-teal-800 text-xs font-bold"><i class="fas fa-plus mr-1"></i>Crear mini-paquete</button>' : '';
        return '<div id="mini-paquetes-terminal" class="mb-4 flex flex-wrap gap-2 items-center"><span class="text-[11px] font-extrabold uppercase text-slate-400 mr-1">Mini-paquetes:</span>'
            + paqs.map(p => '<button type="button" onclick="AdminController.meterPaqueteEnCarrito(\'' + e(p.paquete_id) + '\')" class="px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-bold"><i class="fas fa-kit-medical mr-1"></i>' + e(p.nombre) + '</button>').join('')
            + (paqs.length ? '' : '<span class="text-xs text-slate-400">Sin paquetes (ej. Inyección, Canalización, Paquete Cesárea).</span>') + crear + '</div>';
    },
    abrirDevolucionFarmacia: function (movimientoId) {
        const S = BelenStore;
        const m = (S.listarMovimientosFarmacia() || []).find(x => x.movimiento_id === movimientoId);
        if (!m) return;
        const cls = 'w-full border border-slate-300 rounded-lg p-2 text-sm';
        BelenUI.modal({
            titulo: 'Devolver / Cancelar surtido', subtitulo: (m.principio_activo || '') + ' · lote ' + (m.lote || ''), icono: 'fa-rotate-left', tipo: 'alerta', ancho: 'md',
            html: '<div class="space-y-3 text-left text-sm"><p>Salida de <b>' + this.e(m.cantidad_piezas) + '</b> pzas a ' + this.e(m.paciente_nombre || m.area_paciente || '') + '.</p>'
                + '<label class="block text-[11px] font-bold text-slate-500 uppercase">Piezas a devolver</label><input id="dev-cant" type="number" min="1" max="' + this.e(m.cantidad_piezas) + '" value="' + this.e(m.cantidad_piezas) + '" class="' + cls + '">'
                + '<label class="block text-[11px] font-bold text-slate-500 uppercase">Motivo</label><input id="dev-motivo" class="' + cls + '" placeholder="Ej. no se aplicó, cambio de indicación"><p id="dev-error" class="text-xs text-red-600"></p></div>',
            botones: [{ texto: 'Cancelar', estilo: 'secundario' }, { texto: 'Devolver al inventario', estilo: 'peligro', alPulsar: c => {
                const r = S.devolverSalidaFarmacia(movimientoId, { cantidad: c.el.querySelector('#dev-cant').value, motivo: c.el.querySelector('#dev-motivo').value }, this.sesion);
                if (!r.ok) { c.el.querySelector('#dev-error').textContent = r.motivo; return false; }
                BelenUI.toast('Devolución registrada. Saldo del lote: ' + r.saldo_lote + '.', 'exito'); this.render();
            } }]
        });
    },
    abrirBajaFarmacia: function (loteId) {
        const S = BelenStore;
        const p = S.listarInventarioFarmacia(this.sesion).find(x => x.lote_id === loteId);
        if (!p) return;
        const cls = 'w-full border border-slate-300 rounded-lg p-2 text-sm';
        BelenUI.modal({
            titulo: 'Dar de baja por caducidad / merma', subtitulo: p.nombre + ' · lote ' + p.lote + ' · cad. ' + S.fechaLegibleISO(p.caducidad), icono: 'fa-trash-can', tipo: 'alerta', ancho: 'md',
            html: '<div class="space-y-3 text-left text-sm"><p>Existencia actual: <b>' + this.e(p.stock) + '</b> pzas.</p>'
                + '<label class="block text-[11px] font-bold text-slate-500 uppercase">Motivo</label><select id="baja-motivo" class="' + cls + '"><option value="CADUCIDAD">Caducidad</option><option value="MERMA_ROTURA">Merma / Rotura</option><option value="OTRO">Otro</option></select>'
                + '<label class="block text-[11px] font-bold text-slate-500 uppercase">Piezas</label><input id="baja-cant" type="number" min="1" max="' + this.e(p.stock) + '" value="1" class="' + cls + '">'
                + '<label class="block text-[11px] font-bold text-slate-500 uppercase">Detalle (opcional)</label><input id="baja-detalle" class="' + cls + '"><p id="baja-error" class="text-xs text-red-600"></p></div>',
            botones: [{ texto: 'Cancelar', estilo: 'secundario' }, { texto: 'Dar de baja', estilo: 'peligro', alPulsar: c => {
                const r = S.darBajaInsumoFarmacia(loteId, { motivo: c.el.querySelector('#baja-motivo').value, cantidad: c.el.querySelector('#baja-cant').value, detalle: c.el.querySelector('#baja-detalle').value }, this.sesion);
                if (!r.ok) { c.el.querySelector('#baja-error').textContent = r.motivo; return false; }
                BelenUI.toast('Baja registrada. Saldo del lote: ' + r.saldo_lote + '.', 'exito'); this.render();
            } }]
        });
    },
    cambiarMesCalendarioQx: function (delta) {
        const S = BelenStore;
        const base = (this.mesCalendarioQx || S.hoyLocal().slice(0, 7)).split('-');
        const dt = new Date(Number(base[0]), Number(base[1]) - 1 + delta, 1);
        this.mesCalendarioQx = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
        this.render();
    },

    irMesActualQx: function () {
        this.mesCalendarioQx = BelenStore.hoyLocal().slice(0, 7);
        this.diaFiltroQx = '';
        this.render();
    },

    seleccionarDiaCalendarioQx: function (fechaIso, mantenerSeleccion) {
        if (mantenerSeleccion) {
            this.diaFiltroQx = fechaIso || '';
        } else {
            this.diaFiltroQx = (this.diaFiltroQx === fechaIso) ? '' : (fechaIso || '');
        }
        this.render();
    },

    formatearFechaLargaQx: function (fechaIso) {
        if (!fechaIso) return 'Sin fecha';
        const p = String(fechaIso).split('-');
        if (p.length !== 3) return fechaIso;
        const dt = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
        const dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
        return (dias[dt.getDay()] || '') + ' ' + Number(p[2]) + ' de ' + (meses[dt.getMonth()] || '') + ' de ' + p[0];
    },

    abrirAgendaDiaCalendarioQx: function (fechaIso) {
        const S = BelenStore, e = t => this.e(t);
        const todas = S.listarCirugias(this.sesion).map(c => (S.fichaCirugia ? S.fichaCirugia(c) : c)).filter(Boolean);
        const delDia = todas.filter(f => (f.fecha || String(f.fecha_hora || '').slice(0, 10)) === fechaIso)
            .sort((a, b) => String(a.hora_inicio || '').localeCompare(String(b.hora_inicio || '')));
        const esAdmin = this.rolActual === 'admin' || this.rolActual === 'administrador';
        const tituloFecha = this.formatearFechaLargaQx(fechaIso);

        const filasHtml = delDia.length ? delDia.map((f, idx) => {
            const col = this.colorCirujanoCalendario(f.medico_cirujano_id, f.confirmada_admin);
            const salaCorta = String(f.sala || '').indexOf('GRANDE') >= 0 ? 'Quirófano Grande' : 'Quirófano Chico';
            const badgeEst = f.confirmada_admin
                ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300"><i class="fas fa-circle-check mr-1"></i>Autorizada</span>'
                : '<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-900 border border-amber-300"><i class="fas fa-clock mr-1"></i>⏳ Por autorizar</span>';
            return `<div class="rounded-xl border border-slate-200 ${col.card} p-3 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div class="space-y-1 min-w-0">
                    <div class="flex flex-wrap items-center gap-1.5">
                        <span class="text-xs font-extrabold text-slate-900 bg-slate-100 px-2 py-0.5 rounded-md">#${idx + 1} · ${e(f.hora_inicio || '')}${f.hora_fin ? ' – ' + e(f.hora_fin) : ''}</span>
                        <span class="text-[11px] font-bold px-2 py-0.5 rounded-md bg-violet-50 text-violet-800 border border-violet-200">${salaCorta}</span>
                        ${badgeEst}
                    </div>
                    <p class="text-sm font-extrabold text-slate-900 truncate">${e(f.procedimiento)}</p>
                    <p class="text-xs text-slate-600"><b>Paciente:</b> ${e(f.nombre)} · <b>Cirujano:</b> ${e(f.medico_cirujano)} · <b>Anestesia:</b> ${e(f.anestesiologo || 'Por asignar')}</p>
                </div>
                <div class="shrink-0 flex items-center gap-2">
                    <button type="button" data-abrir-cx-modal="${e(f.cirugia_id)}" class="w-full sm:w-auto px-3 py-2 rounded-xl text-xs font-extrabold ${esAdmin && !f.confirmada_admin ? 'bg-amber-600 hover:bg-amber-700 text-white' : 'bg-violet-600 hover:bg-violet-700 text-white'} shadow-2xs">
                        <i class="fas ${esAdmin ? 'fa-user-check' : 'fa-users-viewfinder'} mr-1"></i>${esAdmin ? (f.confirmada_admin ? 'Editar equipo / Ver' : 'Asignar equipo y Autorizar') : 'Ver quién vendrá y horarios'}
                    </button>
                </div>
            </div>`;
        }).join('') : '<p class="text-sm text-slate-500 py-6 text-center">No hay cirugías programadas en esta fecha.</p>';

        BelenUI.abrirModal({
            titulo: 'Agenda Quirúrgica del Día · ' + tituloFecha + ' (' + delDia.length + ' cirugías)',
            ancho: 'max-w-3xl',
            cuerpo: `<div class="space-y-3">
                <div class="bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700">
                    <span><i class="fas fa-clock text-violet-600 mr-1.5"></i>Ordenadas cronológicamente por horario de inicio. Toque cualquier cirugía para abrir su ficha completa.</span>
                    <button type="button" id="btn-filtrar-dia-modal" class="font-extrabold text-violet-700 hover:underline">Filtrar tarjetas de abajo por este día</button>
                </div>
                <div class="space-y-2.5 max-h-[62vh] overflow-y-auto pr-1">${filasHtml}</div>
            </div>`,
            alAbrir: (raiz, cerrar) => {
                raiz.querySelectorAll('[data-abrir-cx-modal]').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const id = btn.getAttribute('data-abrir-cx-modal');
                        cerrar();
                        this.abrirDetalleCirugiaCalendario(id);
                    });
                });
                const btnFil = raiz.querySelector('#btn-filtrar-dia-modal');
                if (btnFil) {
                    btnFil.addEventListener('click', () => {
                        this.diaFiltroQx = fechaIso;
                        cerrar();
                        this.render();
                    });
                }
            },
            acciones: [{ texto: 'Cerrar', clase: 'px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700' }]
        });
    },

    htmlCalendarioQuirofano: function (lista) {
        const S = BelenStore, e = t => this.e(t);
        const fichas = (lista || []).map(c => (S.fichaCirugia ? S.fichaCirugia(c) : c)).filter(Boolean);
        const hoyIso = S.hoyLocal();
        if (!this.mesCalendarioQx) this.mesCalendarioQx = hoyIso.slice(0, 7);
        const partesMes = this.mesCalendarioQx.split('-');
        const anio = Number(partesMes[0]), mesIdx = Number(partesMes[1]) - 1;
        const nombresMes = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        const tituloMes = (nombresMes[mesIdx] || '') + ' ' + anio;

        const porFecha = {};
        fichas.forEach(f => {
            const k = f.fecha || String(f.fecha_hora || '').slice(0, 10);
            if (!k) return;
            (porFecha[k] = porFecha[k] || []).push(f);
        });
        Object.keys(porFecha).forEach(k => {
            porFecha[k].sort((a, b) => String(a.hora_inicio || '').localeCompare(String(b.hora_inicio || '')));
        });

        // Día activo en la vista móvil tipo App de Calendario
        const prefijoMes = anio + '-' + String(mesIdx + 1).padStart(2, '0') + '-';
        const fechasConQxMes = Object.keys(porFecha).filter(k => k.indexOf(prefijoMes) === 0).sort();
        const diaActivoApp = (this.diaFiltroQx && this.diaFiltroQx.indexOf(prefijoMes) === 0)
            ? this.diaFiltroQx
            : (hoyIso.indexOf(prefijoMes) === 0 && (porFecha[hoyIso] || []).length ? hoyIso : (fechasConQxMes[0] || (hoyIso.indexOf(prefijoMes) === 0 ? hoyIso : prefijoMes + '01')));

        // Calcular cuadrícula mensual (Lunes a Domingo)
        const primerDia = new Date(anio, mesIdx, 1);
        const ultimoDia = new Date(anio, mesIdx + 1, 0);
        const totalDiasMes = ultimoDia.getDate();
        const offsetLunes = (primerDia.getDay() + 6) % 7; // 0 = Lunes, 6 = Domingo
        const totalCeldas = Math.ceil((offsetLunes + totalDiasMes) / 7) * 7;

        const autorizadasCount = fichas.filter(f => f.confirmada_admin).length;
        const pendientesCount = fichas.filter(f => !f.confirmada_admin).length;
        const esAdmin = this.rolActual === 'admin' || this.rolActual === 'administrador';
        const MAX_VISIBLE_DESKTOP = 3;

        const celdasDesktopHtml = [];
        const celdasMovilHtml = [];

        for (let i = 0; i < totalCeldas; i++) {
            const numDia = i - offsetLunes + 1;
            if (numDia < 1 || numDia > totalDiasMes) {
                celdasDesktopHtml.push('<div class="min-h-[128px] bg-slate-50/60 border border-slate-100 rounded-xl p-1.5"></div>');
                celdasMovilHtml.push('<div class="h-14 rounded-xl bg-slate-50/50 border border-transparent"></div>');
                continue;
            }
            const fechaIso = anio + '-' + String(mesIdx + 1).padStart(2, '0') + '-' + String(numDia).padStart(2, '0');
            const esHoy = fechaIso === hoyIso;
            const esFiltro = this.diaFiltroQx === fechaIso;
            const esActivoMovil = diaActivoApp === fechaIso;
            const eventos = porFecha[fechaIso] || [];
            const visiblesDesktop = eventos.slice(0, MAX_VISIBLE_DESKTOP);
            const ocultasCount = Math.max(0, eventos.length - MAX_VISIBLE_DESKTOP);

            const eventosHtml = visiblesDesktop.map(f => {
                const col = this.colorCirujanoCalendario(f.medico_cirujano_id, f.confirmada_admin);
                const salaCorta = String(f.sala || '').indexOf('GRANDE') >= 0 ? 'QX Gde' : 'QX Chi';
                const iconoEstado = f.confirmada_admin
                    ? '<i class="fas fa-circle-check text-emerald-700" title="Autorizada por Administración"></i>'
                    : '<i class="fas fa-clock text-amber-700" title="Pendiente de autorizar por Administración"></i>';
                return `<button type="button" data-cal-cirugia="${e(f.cirugia_id)}" onclick="AdminController.abrirDetalleCirugiaCalendario('${e(f.cirugia_id)}')"
                    class="w-full text-left rounded-lg px-2 py-1 mb-1 text-[11px] leading-tight transition shadow-2xs ${col.chip}">
                    <div class="flex items-center justify-between gap-1 font-extrabold">
                        <span>${e(f.hora_inicio || '')}${f.hora_fin ? '–' + e(f.hora_fin) : ''}</span>
                        <span class="text-[10px] flex items-center gap-1">${salaCorta} ${iconoEstado}</span>
                    </div>
                    <div class="font-bold truncate" title="${e(f.procedimiento)} · ${e(f.nombre)}">${e(f.procedimiento)}</div>
                    <div class="text-[10px] opacity-85 truncate">${e(f.nombre)} · ${e(f.medico_cirujano)}</div>
                </button>`;
            }).join('');

            const botonMasHtml = ocultasCount > 0
                ? `<button type="button" data-cal-mas="${fechaIso}" onclick="AdminController.abrirAgendaDiaCalendarioQx('${fechaIso}')"
                    class="w-full text-center rounded-lg px-2 py-1 mt-0.5 text-[11px] font-extrabold bg-violet-100 hover:bg-violet-200 text-violet-900 border border-violet-300 transition shadow-2xs">
                    +${ocultasCount} ${ocultasCount === 1 ? 'cirugía más' : 'cirugías más'} · Ver las ${eventos.length}
                </button>`
                : '';

            celdasDesktopHtml.push(`<div data-cal-fecha="${fechaIso}" class="min-h-[128px] rounded-xl p-2 flex flex-col justify-between transition border ${esHoy ? 'border-2 border-violet-600 bg-violet-50/40 ring-2 ring-violet-200' : (esFiltro ? 'border-2 border-indigo-500 bg-indigo-50/25' : 'border-slate-200 bg-white hover:border-slate-300')}">
                <div>
                    <div class="flex items-center justify-between mb-1.5">
                        <button type="button" onclick="AdminController.seleccionarDiaCalendarioQx('${fechaIso}')" class="inline-flex items-center gap-1 text-xs font-extrabold ${esHoy ? 'bg-violet-600 text-white px-2 py-0.5 rounded-full shadow-xs' : 'text-slate-700 hover:text-violet-700 px-1'}" title="Filtrar tarjetas de este día">
                            <span>${numDia}</span>
                            ${esHoy ? '<span class="text-[9px] uppercase tracking-wider">Hoy</span>' : ''}
                        </button>
                        ${eventos.length ? `<button type="button" onclick="AdminController.abrirAgendaDiaCalendarioQx('${fechaIso}')" class="text-[10px] font-extrabold px-1.5 py-0.5 rounded-md ${eventos.length >= 4 ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-violet-100 hover:text-violet-800'}" title="Ver agenda completa del día">${eventos.length} qx</button>` : ''}
                    </div>
                    <div>${eventosHtml}${botonMasHtml}</div>
                </div>
            </div>`);

            // Celda compacta para Celular tipo App de Calendario (iOS / Google Calendar móvil)
            const dotsMovil = eventos.slice(0, 4).map(f => {
                const col = this.colorCirujanoCalendario(f.medico_cirujano_id, f.confirmada_admin);
                return `<span class="w-1.5 h-1.5 rounded-full ${col.dot}"></span>`;
            }).join('');
            const extraDots = eventos.length > 4 ? `<span class="text-[8px] font-black leading-none ${esActivoMovil ? 'text-white' : 'text-violet-700'}">+${eventos.length - 4}</span>` : '';

            celdasMovilHtml.push(`<button type="button" data-cal-movil-fecha="${fechaIso}" onclick="AdminController.seleccionarDiaCalendarioQx('${fechaIso}', true)"
                class="h-14 rounded-xl p-1 flex flex-col items-center justify-between transition border ${esActivoMovil ? 'bg-violet-600 text-white border-violet-700 shadow-sm ring-2 ring-violet-200' : (esHoy ? 'border-2 border-violet-500 bg-violet-50/70 text-violet-900' : (eventos.length ? 'bg-white border-slate-200 text-slate-800 hover:border-violet-300' : 'bg-slate-50/60 border-slate-100 text-slate-400'))}">
                <div class="w-full flex items-center justify-between px-0.5">
                    <span class="text-xs font-extrabold leading-none">${numDia}</span>
                    ${eventos.length ? `<span class="text-[9px] font-black px-1 rounded-full leading-tight ${esActivoMovil ? 'bg-white/25 text-white' : (eventos.length >= 4 ? 'bg-violet-100 text-violet-800' : 'bg-slate-100 text-slate-600')}">${eventos.length}</span>` : ''}
                </div>
                <div class="flex items-center justify-center gap-0.5 min-h-[10px]">
                    ${dotsMovil}${extraDots}
                </div>
            </button>`);
        }

        // Agenda del día seleccionado para la vista móvil tipo App
        const eventosDiaMovil = porFecha[diaActivoApp] || [];
        const agendaMovilItems = eventosDiaMovil.length ? eventosDiaMovil.map(f => {
            const col = this.colorCirujanoCalendario(f.medico_cirujano_id, f.confirmada_admin);
            const salaCorta = String(f.sala || '').indexOf('GRANDE') >= 0 ? 'QX Grande' : 'QX Chico';
            const estadoTag = f.confirmada_admin
                ? '<span class="text-[10px] font-extrabold text-emerald-800 bg-emerald-100 px-1.5 py-0.5 rounded-md"><i class="fas fa-check mr-0.5"></i>Autorizada</span>'
                : '<span class="text-[10px] font-extrabold text-amber-900 bg-amber-100 px-1.5 py-0.5 rounded-md"><i class="fas fa-clock mr-0.5"></i>Por autorizar</span>';
            return `<button type="button" onclick="AdminController.abrirDetalleCirugiaCalendario('${e(f.cirugia_id)}')"
                class="w-full text-left rounded-xl p-2.5 border border-slate-200 bg-white hover:bg-slate-50 transition shadow-2xs flex items-start gap-2.5 ${col.card}">
                <div class="shrink-0 text-center bg-slate-100 rounded-lg px-2 py-1 min-w-[58px]">
                    <div class="text-xs font-black text-slate-900">${e(f.hora_inicio || '--:--')}</div>
                    <div class="text-[10px] font-semibold text-slate-500">${e(f.hora_fin || '')}</div>
                </div>
                <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center justify-between gap-1 mb-0.5">
                        <span class="text-[10px] font-extrabold uppercase tracking-wide text-violet-700">${salaCorta}</span>
                        ${estadoTag}
                    </div>
                    <div class="text-xs font-extrabold text-slate-900 truncate">${e(f.procedimiento)}</div>
                    <div class="text-[11px] text-slate-600 truncate">${e(f.nombre)}</div>
                    <div class="text-[10px] text-slate-500 truncate mt-0.5"><i class="fas fa-user-doctor mr-1"></i>${e(f.medico_cirujano)} · Anest: ${e(f.anestesiologo || 'Por asignar')}</div>
                </div>
            </button>`;
        }).join('') : `<div class="text-center py-6 text-xs text-slate-400 bg-white rounded-xl border border-dashed border-slate-200">Sin cirugías programadas en este día. Toque otro día con puntitos de color.</div>`;

        const leyendaMedicos = [
            ['dr_arturo', 'Dr. Arturo Gómez (Cirugía Gral.)'],
            ['dra_patricia', 'Dra. Patricia Gómez (Gineco-Obst.)'],
            ['dr_roberto', 'Dr. Roberto Flores (Angiología)']
        ].map(([id, et]) => {
            const c = this.colorCirujanoCalendario(id, true);
            return `<span class="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-1"><span class="w-3 h-3 rounded-full ${c.dot}"></span>${e(et)}</span>`;
        }).join('');

        const avisoPendientesAdmin = (esAdmin && pendientesCount > 0)
            ? `<div class="mb-3 bg-amber-50 border border-amber-300 rounded-xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-950">
                <span><i class="fas fa-bell text-amber-600 mr-1.5"></i><b>Para Alfonso (Administración):</b> Hay <b>${pendientesCount} cirugías en color ámbar</b> pendientes de revisar, asignar equipo y autorizar. Tóquelas directamente en el calendario.</span>
            </div>` : '';

        return `<section id="calendario-quirofano" class="mb-6 bg-white rounded-2xl border border-slate-200 shadow-sm p-3.5 sm:p-5">
            <div class="flex flex-wrap items-center justify-between gap-3 mb-3 pb-3 border-b border-slate-100">
                <div>
                    <h3 class="text-base font-extrabold text-slate-900 flex items-center gap-2">
                        <i class="fas fa-calendar-days text-violet-600"></i> Calendario Mensual de Quirófano
                    </h3>
                    <p class="text-xs text-slate-500 mt-0.5">Toque cualquier cirugía para ver horarios, indicaciones y quién vendrá${esAdmin ? ', o para asignar equipo y autorizarla' : ''}.</p>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    <span class="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200"><i class="fas fa-circle-check mr-1"></i>${autorizadasCount} autorizadas</span>
                    <span class="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-900 border border-amber-300"><i class="fas fa-clock mr-1"></i>${pendientesCount} por autorizar</span>
                    <div class="flex items-center bg-slate-100 rounded-xl p-1 gap-1">
                        <button type="button" onclick="AdminController.cambiarMesCalendarioQx(-1)" class="px-2.5 py-1.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 text-xs font-extrabold shadow-2xs" title="Mes anterior"><i class="fas fa-chevron-left"></i></button>
                        <span class="px-2.5 text-sm font-extrabold text-slate-900 min-w-[125px] text-center">${e(tituloMes)}</span>
                        <button type="button" onclick="AdminController.cambiarMesCalendarioQx(1)" class="px-2.5 py-1.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 text-xs font-extrabold shadow-2xs" title="Mes siguiente"><i class="fas fa-chevron-right"></i></button>
                    </div>
                    <button type="button" onclick="AdminController.irMesActualQx()" class="px-3 py-1.5 rounded-xl border border-violet-300 bg-violet-50 hover:bg-violet-100 text-violet-800 text-xs font-extrabold">Hoy</button>
                </div>
            </div>
            ${avisoPendientesAdmin}
            <div class="flex flex-wrap items-center gap-1.5 sm:gap-2 mb-3">
                <span class="text-[11px] font-extrabold uppercase text-slate-400 mr-1">Colores por médico (autorizadas):</span>
                ${leyendaMedicos}
                <span class="inline-flex items-center gap-1.5 text-xs font-extrabold text-amber-900 bg-amber-50 border border-amber-300 rounded-full px-2.5 py-1"><span class="w-3 h-3 rounded-full bg-amber-500"></span>⏳ Por autorizar (Administración)</span>
            </div>

            <!-- VISTA MÓVIL / CELULAR TIPO APP DE CALENDARIO (< 1024px) -->
            <div class="lg:hidden space-y-3">
                <div>
                    <div class="grid grid-cols-7 gap-1 mb-1 text-center text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                        <div>Lun</div><div>Mar</div><div>Mié</div><div>Jue</div><div>Vie</div><div>Sáb</div><div>Dom</div>
                    </div>
                    <div class="grid grid-cols-7 gap-1">
                        ${celdasMovilHtml.join('')}
                    </div>
                </div>
                <div class="bg-slate-50 rounded-2xl border border-slate-200 p-3">
                    <div class="flex items-center justify-between gap-2 mb-2.5">
                        <div>
                            <p class="text-[10px] font-extrabold uppercase tracking-wider text-violet-700">Agenda del día seleccionado</p>
                            <h4 class="text-sm font-extrabold text-slate-900">${e(this.formatearFechaLargaQx(diaActivoApp))}</h4>
                        </div>
                        <span class="text-xs font-extrabold px-2.5 py-1 rounded-full bg-violet-100 text-violet-900">${eventosDiaMovil.length} ${eventosDiaMovil.length === 1 ? 'cirugía' : 'cirugías'}</span>
                    </div>
                    <div class="space-y-2 max-h-[340px] overflow-y-auto pr-0.5">
                        ${agendaMovilItems}
                    </div>
                </div>
            </div>

            <!-- VISTA ESCRITORIO TIPO GOOGLE CALENDAR (>= 1024px) -->
            <div class="hidden lg:block">
                <div class="grid grid-cols-7 gap-2 mb-1.5 text-center text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                    <div>Lun</div><div>Mar</div><div>Mié</div><div>Jue</div><div>Vie</div><div>Sáb</div><div>Dom</div>
                </div>
                <div class="grid grid-cols-7 gap-2">
                    ${celdasDesktopHtml.join('')}
                </div>
            </div>
        </section>`;
    },

    abrirDetalleCirugiaCalendario: function (cirugiaId) {
        const S = BelenStore, c = S.cirugiaPara(cirugiaId, this.sesion);
        if (!c) { BelenUI.toast('No se encontró la cirugía.', 'alerta'); return; }
        const e = x => this.e(x);
        const esAdmin = this.rolActual === 'admin' || this.rolActual === 'administrador';
        const col = this.colorCirujanoCalendario(c.medico_cirujano_id, c.confirmada_admin);
        const anests = S.anestesiologos();
        const pediatras = (S.medicosDeEspecialidad ? S.medicosDeEspecialidad('PEDIATRIA') : []);
        const cls = 'w-full border border-slate-300 rounded-lg p-2 text-sm bg-white';

        const bannerEstado = c.confirmada_admin
            ? `<div class="bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-xl p-3 flex items-center justify-between gap-2 text-xs">
                <div><i class="fas fa-circle-check text-emerald-600 mr-1.5"></i><b>Cirugía Autorizada por Administración</b>${c.confirmada_por_nombre ? ' · Confirmó: ' + e(c.confirmada_por_nombre) : ''}</div>
                <span class="font-extrabold px-2.5 py-0.5 rounded-full border ${col.badge}">${e(c.medico_cirujano)}</span>
            </div>`
            : `<div class="bg-amber-50 border-2 border-amber-300 text-amber-950 rounded-xl p-3 text-xs">
                <div class="font-extrabold text-sm"><i class="fas fa-clock text-amber-600 mr-1.5"></i>Pendiente de Confirmación por Administración (Alfonso)</div>
                <p class="mt-0.5 text-amber-800">${esAdmin ? 'Revise el horario, asigne el equipo quirúrgico abajo y pulse "Autorizar Cirugía" para confirmarla en el calendario.' : 'Esta cirugía fue solicitada por el médico y está en espera de que Administración (Alfonso) confirme la sala y el equipo.'}</p>
            </div>`;

        const fichaLectura = `<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs">
            <div><span class="text-[10px] font-bold uppercase text-slate-400 block">Fecha y Horario</span><b class="text-sm text-slate-900">${e(c.fecha_texto)}</b><span class="block font-extrabold text-violet-700 text-sm">${e(c.hora_texto)} (${e(c.duracion_texto || '')})</span></div>
            <div><span class="text-[10px] font-bold uppercase text-slate-400 block">Sala y Modalidad</span><b class="text-sm text-slate-900">${e(c.sala_nombre)}</b><span class="block font-bold text-slate-600">${c.tipo_estancia === 'AMBULATORIA' ? 'Cirugía Ambulatoria' : 'Cirugía con Hospitalización'}</span></div>
            <div><span class="text-[10px] font-bold uppercase text-slate-400 block">Paciente</span><b class="text-sm text-slate-900">${e(c.nombre)}</b><span class="block text-slate-600">Nac: ${e(S.fechaLegibleISO(c.fecha_nacimiento))} (${S.formatearEdad ? S.formatearEdad(c.fecha_nacimiento, c.edad) : (c.edad + ' años')})</span></div>
        </div>
        <div class="bg-white border border-slate-200 rounded-xl p-3.5 text-xs">
            <p class="text-[11px] font-extrabold uppercase text-slate-500 mb-2"><i class="fas fa-users-medical text-violet-600 mr-1"></i>¿Quién vendrá? · Equipo Quirúrgico Programado</p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div><span class="text-slate-400 font-bold uppercase text-[10px] block">Médico Cirujano Titular</span><b class="text-slate-900">${e(c.medico_cirujano)}</b> <span class="text-slate-500">(${e(c.medico_especialidad || 'Cirugía')})</span></div>
                <div><span class="text-slate-400 font-bold uppercase text-[10px] block">Anestesiólogo</span><b class="${c.anestesiologo ? 'text-slate-900' : 'text-amber-700'}">${e(c.anestesiologo || 'Pendiente de asignar por Administración')}</b></div>
                <div><span class="text-slate-400 font-bold uppercase text-[10px] block">Primer Ayudante</span><b class="text-slate-800">${e(c.ayudante_nombre || 'Por asignar')}</b></div>
                <div><span class="text-slate-400 font-bold uppercase text-[10px] block">Instrumentista</span><b class="text-slate-800">${e(c.instrumentista_nombre || 'Por asignar')}</b></div>
                <div><span class="text-slate-400 font-bold uppercase text-[10px] block">Enfermera Circulante</span><b class="text-slate-800">${e(c.circulante_nombre || 'Por asignar')}</b></div>
                ${c.requiere_pediatra || c.pediatra_nombre ? `<div><span class="text-slate-400 font-bold uppercase text-[10px] block">Pediatra (Recepción RN)</span><b class="text-slate-800">${e(c.pediatra_nombre || 'Dr. Carlos Méndez')}</b></div>` : ''}
            </div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div class="bg-cyan-50 border border-cyan-200 rounded-xl p-3">
                <p class="text-[10px] font-extrabold uppercase text-cyan-900 mb-1"><i class="fas fa-clipboard-list mr-1"></i>Indicaciones Preoperatorias</p>
                <p class="text-slate-800 whitespace-pre-wrap">${c.indicaciones_preoperatorias ? e(c.indicaciones_preoperatorias) : 'Sin indicaciones preoperatorias registradas.'}</p>
            </div>
            <div class="bg-yellow-50 border border-yellow-200 rounded-xl p-3">
                <p class="text-[10px] font-extrabold uppercase text-yellow-800 mb-1"><i class="fas fa-note-sticky mr-1"></i>Notas de Programación / Insumos</p>
                <p class="text-slate-800 whitespace-pre-wrap">${e(c.notas_confirmacion || c.notas || 'Sin notas adicionales.')}</p>
            </div>
        </div>`;

        const formAdmin = esAdmin ? `<div class="border-t-2 border-slate-200 pt-3 mt-1">
            <p class="text-xs font-extrabold uppercase text-emerald-800 mb-2.5"><i class="fas fa-user-tie mr-1"></i>Panel de Alfonso (Administración) · Asignar Equipo y Autorizar</p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
                <div>
                    <label class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Anestesiólogo del hospital</label>
                    <select id="conf-qx-anest-id" class="${cls}">
                        <option value="">— Seleccionar o escribir externo —</option>
                        ${anests.map(a => `<option value="${e(a.id)}" ${c.anestesiologo_id === a.id ? 'selected' : ''}>${e(a.nombre)}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Anestesiólogo externo (si aplica)</label>
                    <input id="conf-qx-anest-txt" type="text" value="${e(!c.anestesiologo_id ? (c.anestesiologo || '') : '')}" placeholder="Dr. / Dra. Anestesiólogo externo" class="${cls}">
                </div>
                <div>
                    <label class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Primer Ayudante / Asistente</label>
                    <input id="conf-qx-ayudante" type="text" value="${e(c.ayudante_nombre || '')}" placeholder="Ej. Dr. Marco Antonio Vega" class="${cls}">
                </div>
                <div>
                    <label class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Instrumentista</label>
                    <input id="conf-qx-inst" type="text" value="${e(c.instrumentista_nombre || '')}" placeholder="Ej. Lic. Enf. Sofía Ríos" class="${cls}">
                </div>
                <div>
                    <label class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Enfermera Circulante</label>
                    <input id="conf-qx-circ" type="text" value="${e(c.circulante_nombre || '')}" placeholder="Ej. Enf. Carmen López" class="${cls}">
                </div>
                <div>
                    <label class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Sala Quirúrgica asignada</label>
                    <select id="conf-qx-sala" class="${cls}">
                        ${(S.SALAS_QUIROFANO || []).map(s => `<option value="${e(s.codigo)}" ${c.sala === s.codigo ? 'selected' : ''}>${e(s.nombre)}</option>`).join('')}
                    </select>
                </div>
                <div class="sm:col-span-2">
                    <label class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Notas de Administración / Insumos CEYE o Motivo en caso de rechazo</label>
                    <input id="conf-qx-notas" type="text" value="${e(c.notas_confirmacion || '')}" placeholder="Ej. Equipo confirmado con cirujano; paquete listo en CEYE" class="${cls}">
                </div>
                <p id="conf-qx-err" class="sm:col-span-2 text-xs text-red-600 hidden"></p>
            </div>
        </div>` : '';

        const botones = [{ texto: 'Cerrar', estilo: 'secundario' }];
        if (!esAdmin && S.puedeIngresarAmbulatorio(this.sesion) && c.tipo_estancia === 'AMBULATORIA' && !c.ingresada && !c.ya_internado) {
            botones.push({
                texto: '1. Ingresar Paciente a Quirófano',
                estilo: 'primario',
                alPulsar: () => { this.confirmarIngresoAmbulatorio(c.cirugia_id); }
            });
        }
        if (esAdmin) {
            botones.push({
                texto: '❌ Rechazar / Cancelar Cirugía',
                estilo: 'peligro',
                alPulsar: m => {
                    const motivo = (m.el.querySelector('#conf-qx-notas') && m.el.querySelector('#conf-qx-notas').value) || 'Programación no autorizada por Administración';
                    const r = S.rechazarCirugiaAdmin(cirugiaId, motivo, this.sesion);
                    if (!r || !r.ok) {
                        BelenUI.toast((r && r.motivo) || 'No se pudo cancelar.', 'alerta');
                        return false;
                    }
                    BelenUI.toast('Cirugía rechazada y retirada del calendario.', 'alerta');
                    this.render();
                }
            });
            botones.push({
                texto: c.confirmada_admin ? '✅ Guardar Cambios de Equipo' : '✅ Autorizar Cirugía y Guardar Equipo',
                estilo: 'exito',
                alPulsar: m => {
                    const q = id => m.el.querySelector('#' + id).value;
                    const r = S.confirmarCirugiaAdmin(cirugiaId, {
                        anestesiologo_id: q('conf-qx-anest-id'),
                        anestesiologo_nombre: q('conf-qx-anest-txt'),
                        ayudante_nombre: q('conf-qx-ayudante'),
                        instrumentista_nombre: q('conf-qx-inst'),
                        circulante_nombre: q('conf-qx-circ'),
                        sala: q('conf-qx-sala'),
                        notas_confirmacion: q('conf-qx-notas')
                    }, this.sesion);
                    if (!r || !r.ok) {
                        const err = m.el.querySelector('#conf-qx-err');
                        if (err) { err.textContent = (r && r.motivo) || 'No se pudo confirmar.'; err.classList.remove('hidden'); }
                        return false;
                    }
                    BelenUI.toast('Cirugía autorizada por Administración. Ya aparece con el color del médico en el calendario.', 'exito');
                    this.render();
                }
            });
        }

        BelenUI.modal({
            titulo: c.procedimiento,
            subtitulo: 'Paciente: ' + c.nombre + ' · ' + c.sala_nombre,
            icono: 'fa-kit-medical',
            ancho: 'xl',
            html: `<div class="space-y-3 text-left">${bannerEstado}${fichaLectura}${formAdmin}</div>`,
            botones: botones
        });
    },

    htmlControlesQuirofano: function (listaVisible) {
        const S = BelenStore, e = t => this.e(t);
        if (!S.listarInternamientos) return '';
        const hoyIso = S.hoyLocal();
        const fichas = (listaVisible || S.cirugiasVisibles(this.sesion) || []).map(c => (S.fichaCirugia ? S.fichaCirugia(c) : c)).filter(Boolean);

        // Paso 1: Cirugías de hoy o próximas listas para ingresar a quirófano
        const listasParaIngresar = fichas.filter(f => !f.ingresada && !f.ya_internado && f.fecha >= hoyIso).slice(0, 4);

        // Pasos 2 y 3: Pacientes que ya están en tránsito a quirófano o dentro de quirófano/recuperación
        const ints = S.listarInternamientos().filter(i => i && i.estatus === 'activo' && (i.ubicacion === 'EN_TRANSITO_QUIROFANO' || i.ubicacion === 'QUIROFANO' || i.modalidad === S.MODALIDAD_AMBULATORIO_QX));

        const tarjetasActivos = ints.map(i => {
            const t = S.obtenerTurno(i.turno_id) || {};
            const id = e(i.turno_id);
            const enTransito = i.ubicacion === 'EN_TRANSITO_QUIROFANO';
            const esAmb = i.modalidad === S.MODALIDAD_AMBULATORIO_QX;
            const tienePostop = !!((i.notas_postoperatorias || []).length);
            const urlExp = 'expediente.html?modo=hospitalizado&turno=' + encodeURIComponent(i.turno_id);

            const pasoBadge = enTransito
                ? '<span class="text-[10px] font-extrabold uppercase px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300">Paso 2 de 3 · En puerta de Quirófano (Falta asignar camilla)</span>'
                : '<span class="text-[10px] font-extrabold uppercase px-2.5 py-1 rounded-full bg-violet-100 text-violet-900 border border-violet-300">Paso 3 de 3 · En Quirófano / Recuperación (' + e(i.cama || 'Camilla asignada') + ')</span>';

            const botonesPaso = enTransito
                ? `<div class="flex flex-wrap items-center gap-2 mt-2">
                    <span class="text-xs font-bold text-slate-600 mr-1">Elegir camilla donde se recibe:</span>
                    ${['REC-1', 'REC-2', 'REC-GINECO'].map(cama => `<button type="button" onclick="AdminController.accionQx('recibir','${id}','${cama}')" class="px-3 py-2 rounded-xl bg-violet-700 hover:bg-violet-800 text-white text-xs font-extrabold shadow-xs"><i class="fas fa-bed-pulse mr-1"></i>Recibir en ${cama}</button>`).join('')}
                </div>`
                : `<div class="flex flex-wrap items-center gap-2 mt-2">
                    <a href="${urlExp}" class="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold"><i class="fas fa-folder-open mr-1"></i>Abrir Expediente / Notas Qx</a>
                    ${S.puedeNotaPostoperatoria(this.sesion, i) ? `<button type="button" onclick="AdminController.abrirNotaPostoperatoria('${id}')" class="px-3 py-2 rounded-xl bg-violet-700 hover:bg-violet-800 text-white text-xs font-extrabold"><i class="fas fa-file-signature mr-1"></i>${tienePostop ? 'Ver / Editar Nota Post-Operatoria' : 'Firmar Nota Post-Operatoria'}</button>` : ''}
                    ${!esAmb ? `<button type="button" onclick="AdminController.accionQx('piso','${id}')" class="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold"><i class="fas fa-bed mr-1"></i>3. Regresar a Cama de Hospitalización</button>` : ''}
                    ${esAmb ? `<button type="button" onclick="AdminController.accionQx('alta','${id}')" class="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold"><i class="fas fa-circle-check mr-1"></i>3. Dar Alta Ambulatoria (Enviar a Caja)</button>` : ''}
                </div>`;

            return `<div class="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 flex flex-col gap-1.5">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <span class="font-extrabold text-sm text-slate-900">${e(t.paciente_nombre || '')}</span>
                        <span class="text-xs text-slate-500 ml-2">${esAmb ? 'Cirugía Ambulatoria' : 'Paciente de Hospitalización'} · Dr(a). ${e(t.medico_nombre || '')}</span>
                    </div>
                    ${pasoBadge}
                </div>
                ${botonesPaso}
            </div>`;
        }).join('');

        const tarjetasPaso1 = listasParaIngresar.map(f => `<div class="rounded-xl border border-dashed border-cyan-300 bg-cyan-50/40 p-3 flex flex-wrap items-center justify-between gap-2">
            <div class="text-xs">
                <span class="font-extrabold text-slate-900">${e(f.nombre)}</span>
                <span class="text-slate-600"> · ${e(f.procedimiento)} (${e(f.fecha_texto)} ${e(f.hora_inicio || '')})</span>
            </div>
            ${S.puedeIngresarAmbulatorio(this.sesion) ? `<button type="button" onclick="AdminController.confirmarIngresoAmbulatorio('${e(f.cirugia_id)}')" class="px-3 py-1.5 rounded-xl bg-cyan-700 hover:bg-cyan-800 text-white text-xs font-extrabold shadow-xs"><i class="fas fa-right-to-bracket mr-1"></i>1. Ingresar a Quirófano</button>` : ''}
        </div>`).join('');

        return `<section id="controles-quirofano" class="mb-6 bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5">
            <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div>
                    <h3 class="text-sm font-extrabold uppercase text-slate-800 flex items-center gap-2"><i class="fas fa-route text-violet-600"></i> ¿Cómo funciona el paso de un paciente por Quirófano? (3 Pasos)</h3>
                    <p class="text-xs text-slate-500">Guía rápida para ingresar al paciente programado, recibirlo en camilla y regresarlo a piso o darle alta.</p>
                </div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-2.5 mb-4 text-xs">
                <div class="rounded-xl bg-cyan-50 border border-cyan-200 p-3">
                    <p class="font-extrabold text-cyan-950">Paso 1 · Ingresar a Quirófano</p>
                    <p class="text-cyan-800 mt-0.5">Cuando llega el paciente programado, pulse <b>"1. Ingresar a Quirófano"</b> para abrir su expediente quirúrgico sin pasar por consulta.</p>
                </div>
                <div class="rounded-xl bg-violet-50 border border-violet-200 p-3">
                    <p class="font-extrabold text-violet-950">Paso 2 · Asignar Camilla (REC-1 / REC-2)</p>
                    <p class="text-violet-800 mt-0.5">Enfermería de Quirófano recibe al paciente eligiendo su camilla (<b>Recuperación 1, 2 o Gineco</b>) y el cirujano llena su Hoja Quirúrgica.</p>
                </div>
                <div class="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
                    <p class="font-extrabold text-emerald-950">Paso 3 · Regresar a Piso o Alta</p>
                    <p class="text-emerald-800 mt-0.5">Con la Nota Post-Operatoria lista, si se queda internado pasa a <b>Cama de Hospitalización</b>; si es ambulatorio se da <b>Alta a Caja</b>.</p>
                </div>
            </div>
            ${tarjetasActivos ? `<div class="space-y-2.5 mb-3"><p class="text-xs font-extrabold uppercase text-slate-500">Pacientes actualmente dentro de Quirófano / Recuperación (${ints.length})</p>${tarjetasActivos}</div>` : '<p class="text-xs text-slate-500 italic mb-3">En este momento no hay pacientes dentro de las camillas de quirófano.</p>'}
            ${tarjetasPaso1 ? `<div class="space-y-2 pt-3 border-t border-slate-100"><p class="text-xs font-extrabold uppercase text-cyan-800">Próximos pacientes listos para el Paso 1 (Ingresar a Quirófano)</p>${tarjetasPaso1}</div>` : ''}
        </section>`;
    },

    accionQx: function (accion, turnoId, cama) {
        const S = BelenStore;
        if (accion === 'piso' && !cama) {
            const libres = S.camasLibres('HOSPITALIZACION');
            if (!libres.length) { BelenUI.toast('No hay camas libres en Hospitalización.', 'alerta'); return; }
            BelenUI.modal({
                titulo: 'Regresar paciente a Cama de Hospitalización',
                subtitulo: 'Seleccione la habitación de piso a la que pasa el paciente tras su cirugía',
                icono: 'fa-bed',
                ancho: 'md',
                html: `<div class="space-y-2 text-left">
                    <label class="block text-xs font-bold text-slate-600 uppercase">Habitación destino disponible</label>
                    <select id="qx-cama-piso-dest" class="w-full border border-slate-300 rounded-xl p-2.5 text-sm bg-white">
                        ${libres.map(c => `<option value="${this.e(c.codigo)}">${this.e(c.nombre)} (${this.e(c.codigo)})</option>`).join('')}
                    </select>
                </div>`,
                botones: [
                    { texto: 'Cancelar', estilo: 'secundario' },
                    { texto: 'Trasladar a Habitación', estilo: 'primario', alPulsar: m => {
                        const dest = m.el.querySelector('#qx-cama-piso-dest').value;
                        const r = S.regresarAHospitalizacion(turnoId, dest, this.sesion);
                        if (!r || !r.ok) { BelenUI.toast((r && r.motivo) || 'No se pudo completar el traslado.', 'alerta'); return false; }
                        BelenUI.toast('Paciente trasladado a cama de hospitalización.', 'exito');
                        this.render();
                    } }
                ]
            });
            return;
        }
        let r;
        if (accion === 'recibir') r = S.recibirEnQuirofano(turnoId, cama, this.sesion);
        else if (accion === 'piso') r = S.regresarAHospitalizacion(turnoId, cama, this.sesion);
        else if (accion === 'alta') r = S.altaAmbulatoriaQx ? S.altaAmbulatoriaQx(turnoId, this.sesion) : { ok: false, motivo: 'Función no disponible.' };
        if (!r || !r.ok) { BelenUI.toast((r && r.motivo) || 'No se pudo completar la acción.', 'alerta'); return; }
        BelenUI.toast('Listo.', 'exito'); this.render();
    },

    htmlCuentasPorCobrar: function () {
        const S = BelenStore, e = t => this.e(t);
        const filas = S.cuentasPorCobrar(this.sesion).map(t => S.fichaCuenta(t));
        const cuerpo = filas.length ? filas.map(f => {
            const origen = f.origen === 'hospitalizacion' ? 'Hospitalización' : 'Consulta ambulatoria';
            return `<button type="button" data-turno="${e(f.turno_id)}" onclick="AdminController.abrirDesgloseCuenta('${e(f.turno_id)}')"
                class="w-full text-left bg-white border border-amber-200 hover:border-amber-400 hover:shadow-md rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 transition">
                <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2"><h4 class="text-base font-extrabold text-slate-900">${e(f.nombre)}</h4>${this.badgeEstatus({ estatus: f.estatus })}${(S.obtenerTurno(f.turno_id) || {}).liberado_a_caja && f.estatus === 'en_consulta' ? '<span class="text-[10px] font-bold uppercase bg-cyan-100 text-cyan-800 rounded px-2 py-0.5">Pre-cobro · médico sigue escribiendo nota</span>' : ''}</div>
                    <p class="text-xs text-slate-500 mt-0.5">${e(origen)}${f.cama ? ' · ' + e(f.cama) : ''} · ${e(f.medico_nombre)}</p>
                    ${f.diagnostico ? `<p class="text-xs text-slate-600 mt-1">${e(f.diagnostico)}</p>` : ''}
                </div>
                <div class="text-right shrink-0">
                    <p class="text-lg font-extrabold text-amber-800">${e(S.formatoMoneda(f.total))}</p>
                    <p class="text-[11px] font-extrabold text-amber-700 mt-1">Ver Desglose / Cobrar</p>
                    <p class="text-[10px] font-bold uppercase text-amber-600">Sin IVA · ${f.cargos.length} ${f.cargos.length === 1 ? 'concepto' : 'conceptos'}</p>
                </div>
            </button>`;
        }).join('') : `<div class="text-center py-8 text-slate-400 bg-white/70 border border-dashed border-amber-200 rounded-xl">
            <i class="fas fa-circle-check text-2xl text-emerald-300 mb-2"></i>
            <p class="text-sm font-medium">No hay egresos pendientes de cobro.</p></div>`;
        return `<section class="mb-8 bg-amber-50/80 border border-amber-200 rounded-2xl p-5 shadow-sm">
            <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div>
                    <h3 class="text-lg font-extrabold text-amber-950 flex items-center gap-2"><i class="fas fa-cash-register text-amber-600"></i> Cuentas por Cobrar / Egresos Pendientes</h3>
                    <p class="text-xs text-amber-800 mt-0.5">Alta médica pendiente de cobro. El total de la lista es sin IVA; la factura se decide al cobrar.</p>
                </div>
                <span class="text-xs font-extrabold bg-amber-600 text-white rounded-full px-3 py-1">${filas.length}</span>
            </div>
            <div class="flex flex-col gap-2">${cuerpo}</div>
        </section>`;
    },

    enfocarCuenta: function () {
        if (!this.cuentaDestacada) return;
        const art = document.getElementById('cuenta-' + this.cuentaDestacada);
        if (art) art.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },

    abrirDesgloseCuenta: function (turnoId) {
        const S = BelenStore, t = S.obtenerTurno(turnoId);
        if (!t || !S.puede('ver_cuentas_cobrar')) { BelenUI.toast('No puede consultar esta cuenta.', 'alerta'); return; }
        if (!this.vistaPermitida('tarifario')) { BelenUI.toast('Su perfil no tiene acceso a Tarifario y Caja.', 'alerta'); return; }
        this.cuentaDestacada = turnoId;
        this.pestanaTarifario = 'caja';
        this.vista = 'tarifario';
        history.replaceState(null, '', '?vista=tarifario&turno=' + encodeURIComponent(turnoId));
        const self = this;
        this.render().then(function () { self.enfocarCuenta(); });
    },

    confirmarCerrarExpediente: function (turnoId, conFactura, modo, base) {
        const S = BelenStore, t = S.obtenerTurno(turnoId);
        if (!t) return;
        const f = S.fichaCuenta(t);
        const opFiscal = { modo: modo || 'items', base_manual: base };
        const fiscal = S.desgloseFiscal(f.cargos, !!conFactura, opFiscal);
        const detalle = conFactura
            ? 'Subtotal base ' + S.formatoMoneda(fiscal.subtotal) + '. IVA ' + S.formatoMoneda(fiscal.iva) + '. Total con factura ' + S.formatoMoneda(fiscal.total) + '.'
            : 'Se cobra el total sin IVA: ' + S.formatoMoneda(fiscal.total) + '.';
        BelenUI.confirmar({
            titulo: '¿Marcar como pagado y cerrar el expediente?', tipo: 'alerta', textoConfirmar: 'Sí, cobrar y cerrar',
            mensaje: detalle + ' Paciente: ' + f.nombre + '. Desaparecerá de los monitores activos y quedará en la búsqueda histórica.',
            alConfirmar: () => {
                const r = S.cerrarExpedientePagado(turnoId, this.sesion, { requirio_factura: !!conFactura, modo_iva: modo || 'items', base_gravable_manual: base });
                if (!r.ok) { BelenUI.toast(r.motivo, 'peligro'); return false; }
                BelenUI.toast('Expediente cerrado. Cobrado ' + S.formatoMoneda(fiscal.total) + (conFactura ? ' con factura.' : ' sin factura.'), 'exito');
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
            const botonEstudio = (!pendientePago && (f.finalizado || f.estatus === 'internado_en_proceso') && S.permisoAccionDe(s.usuario_id, 'cargar_consumos'))
                ? `<button type="button" onclick="AdminController.abrirTerminalEstudios('${e(f.turno_id)}')" class="bg-cyan-700 hover:bg-cyan-800 text-white text-xs font-extrabold py-2.5 px-3 rounded-lg shadow-sm">🧪 Cargar Estudios / Tubos / Procedimientos</button>` : '';
            const internadoPo = S.internamientoDeTurno(f.turno_id);
            const botonPostop = internadoPo && S.puedeNotaPostoperatoria(s, internadoPo)
                ? `<button type="button" onclick="AdminController.abrirNotaPostoperatoria('${e(f.turno_id)}')" class="bg-violet-700 hover:bg-violet-800 text-white text-xs font-extrabold py-2.5 px-3 rounded-lg shadow-sm">Nota Post-Operatoria</button>` : '';
            const botonCama = (!pendientePago && S.puede('asignar_cama'))
                ? `<button type="button" data-accion="asignar-cama" onclick="AdminController.abrirAsignarCama('${e(f.turno_id)}')" class="bg-white border border-slate-300 hover:border-cyan-500 hover:text-cyan-700 text-slate-700 text-xs font-bold py-2 px-3 rounded-lg transition flex items-center gap-1.5"><i class="fas fa-bed"></i> ${f.cama ? 'Cambiar cama' : 'Asignar cama'}</button>` : '';
            const areaActual = internadoPo ? S.codigoAreaEstancia(internadoPo, S.obtenerTurno(f.turno_id)) : '';
            const botonArea = (!pendientePago && internadoPo && S.puedeCambiarArea(s) && S.areasDestinoEstancia(areaActual).length)
                ? `<button type="button" onclick="AdminController.abrirCambiarArea('${e(f.turno_id)}')" class="bg-white border border-indigo-300 text-indigo-800 hover:bg-indigo-50 text-xs font-bold py-2 px-3 rounded-lg transition">🔄 Cambiar Área de Estancia</button>` : '';
            const botonCorte = (!pendientePago && internadoPo && (s.rol === 'admin' || s.rol === 'administrador') && (areaActual === 'HOSPITALIZACION' || areaActual === 'OBSERVACION' || areaActual === 'QUIROFANO'))
                ? `<button type="button" onclick="AdminController.abrirCorteEstancia('${e(f.turno_id)}')" class="bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold py-2 px-3 rounded-lg transition">🛏️ Aplicar Corte de Estancia / Noche</button>` : '';
            const ics = f.interconsultas.length
                ? f.interconsultas.map(x => `<span class="inline-block bg-indigo-50 text-indigo-700 border border-indigo-200 rounded px-1.5 py-0.5 text-[10px] font-bold mr-1">${e(x.especialidad)} · ${e(x.medico_nombre)}</span>`).join('') : '';
            const borde = pendientePago ? 'border-l-amber-500' : (enProceso ? 'border-l-indigo-500' : 'border-l-slate-400');
            return `<div data-turno="${e(f.turno_id)}" data-paciente="${e(f.paciente_id)}" class="bg-white rounded-2xl border border-slate-200 border-l-4 ${borde} shadow-sm p-5">
                <div class="flex flex-wrap items-start gap-4">
                    <div class="min-w-[4rem] max-w-[11rem] min-h-[4rem] py-1 rounded-xl ${f.cama ? (pendientePago ? 'bg-amber-600 text-white' : 'bg-indigo-600 text-white') : 'bg-slate-100 text-slate-400 border border-dashed border-slate-300'} flex flex-col items-center justify-center shrink-0 text-center px-1">
                        <i class="fas fa-bed text-sm"></i><span data-cama="1" class="text-[11px] font-extrabold leading-tight mt-0.5 break-words">${f.cama ? e(f.cama) : 'Sin cama'}</span></div>
                    <div class="flex-1 min-w-0 sm:min-w-[240px] w-full sm:w-auto">
                        <div class="flex flex-wrap items-center gap-2"><h4 class="text-lg font-bold text-slate-900">${e(f.nombre)}</h4>${this.badgeEstatus({ estatus: f.estatus })}${f.ambulatorio_qx ? '<span class="inline-flex items-center text-[10px] font-extrabold uppercase tracking-wide px-2.5 py-1 rounded-full bg-violet-600 text-cyan-50 border border-cyan-300 shadow-sm">CIRUGÍA AMBULATORIA</span>' : ''}${relacion}</div>
                        <p class="text-xs text-slate-500">${f.edad !== null ? f.edad + ' años' : ''}${sexoTxt(f) ? ' · ' + sexoTxt(f) : ''}${f.area ? ' · ' + e(f.area) : ''}${pendientePago ? ' · ' + e(S.formatoMoneda(f.cuenta_actual || 0)) : ''}</p>
                    </div>
                    <div class="flex flex-wrap gap-2 justify-end">${botonCama}${botonArea}${botonCorte}${botonEstudio}${botonPostop}${accion}</div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 pt-4 border-t border-slate-100">
                    ${dato('Médico tratante', `<span class="font-semibold">${e(f.medico_tratante)}</span><span class="block text-[11px] text-slate-400">${e(f.especialidad)}</span>`)}
                    ${dato('Diagnóstico actual', f.diagnostico_actual ? e(f.diagnostico_actual) : '<span class="text-slate-400">No registrado</span>')}
                    ${dato('Alergias', alergia)}
                </div>
                ${ics ? `<p class="mt-3 text-[11px] text-slate-500"><span class="font-bold uppercase text-slate-400 text-[10px]">Interconsultas:</span> ${ics}</p>` : ''}
            </div>`;
        };
        return `<div class="mb-4 flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h2 class="text-2xl font-extrabold text-slate-800">Monitor de Camas y Pacientes Hospitalizados</h2>
                        <p class="text-slate-500">Acceso directo de 1 clic al expediente clínico desde cada habitación o cama activa.</p>
                    </div>
                    <div class="flex flex-wrap gap-2">
                        <button type="button" onclick="AdminController.alternarMapa2D()" class="bg-white border border-slate-300 hover:border-cyan-500 text-slate-700 text-xs font-extrabold px-3.5 py-2 rounded-xl shadow-sm transition flex items-center gap-2">
                            <i class="fas fa-table-cells-large text-indigo-600"></i> ${this.mostrarMapa2D ? 'Ocultar Tablero de Camas' : 'Mostrar Tablero de Camas'}
                        </button>
                        <button type="button" onclick="AdminController.abrirPlanoArquitectonicoOriginal()" class="bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 text-xs font-bold px-3 py-2 rounded-xl transition flex items-center gap-1.5">
                            <i class="fas fa-image text-slate-500"></i> Plano de Referencia
                        </button>
                    </div>
                </div>
                ${this.htmlPanelEstupefacientes('HOSPITALIZACION')}
                ${this.mostrarMapa2D ? this.htmlMapaArquitectonico2D() : ''}
                <div class="mb-3 flex items-center justify-between">
                    <h3 class="text-sm font-extrabold uppercase tracking-wider text-slate-600"><i class="fas fa-list-check mr-1.5 text-indigo-600"></i> Detalle de Pacientes Hospitalizados (${lista.length})</h3>
                    <span class="text-[11px] text-slate-500">${this.e(modo)}</span>
                </div>
                <div class="flex flex-col gap-3" id="lista-hospitalizados">${lista.length ? lista.map(tarjeta).join('') : '<div class="text-center py-12 text-slate-400 font-medium bg-white rounded-2xl border border-dashed border-slate-300"><i class="fas fa-bed text-3xl mb-2 text-slate-300"></i><p>No hay pacientes hospitalizados asignados a su perfil.</p></div>'}</div>`;
    },

    abrirTerminalEstudios: function (turnoId) {
        BelenUI.abrirTerminalEstudios({ turnoId: turnoId, alGuardar: () => this.render() });
    },

    abrirCargarEstudio: function (turnoId) { this.abrirTerminalEstudios(turnoId); },

    abrirNotaPostoperatoria: function (turnoId) {
        const S = BelenStore;
        const i = S.internamientoDeTurno(turnoId);
        if (!i || !S.puedeNotaPostoperatoria(this.sesion, i)) { BelenUI.toast('Solo el cirujano o Dirección pueden registrar la nota post-operatoria.', 'alerta'); return; }
        BelenUI.modal({
            titulo: 'Hoja Quirúrgica', subtitulo: 'Nota post-operatoria oficial', icono: 'fa-notes-medical', ancho: 'xl',
            html: S.htmlModalHojaQuirurgica(S.prefillHojaQuirurgica(turnoId)),
            botones: [
                { texto: 'Cancelar', estilo: 'secundario' },
                { texto: 'Guardar nota', estilo: 'exito', alPulsar: c => {
                    const entrada = S.leerNotaPostoperatoria(c.el);
                    const r = S.guardarNotaPostoperatoria(turnoId, entrada, this.sesion);
                    const error = c.el.querySelector('#po-error');
                    if (!r.ok) { error.textContent = (r.errores && Object.values(r.errores)[0]) || r.motivo; error.classList.remove('hidden'); return false; }
                    BelenUI.toast(entrada.cargar_biopsia ? 'Nota guardada y biopsia cargada a la cuenta.' : 'Hoja quirúrgica guardada.', 'exito');
                    this.render();
                } }
            ]
        });
    },

    // Asignación de cama: solo el número libre del área actual, con clave por zona.
    abrirAsignarCama: function (turnoId) {
        const S = BelenStore, t = S.obtenerTurno(turnoId);
        if (!t || !S.puede('asignar_cama') || !S.hospitalizadoVisiblePara(t, this.sesion)) { BelenUI.toast('No puede asignar cama a este paciente.', 'alerta'); return; }
        const i = S.internamientoDeTurno(turnoId);
        const area = S.codigoAreaEstancia(i, t);
        const libres = area ? S.camasLibres(area, i && i.internamiento_id) : [];
        const e = x => this.e(x);
        if (!area) { BelenUI.aviso('Sin área', 'Este paciente no tiene un área de estancia. Use Cambiar Área de Estancia.', 'alerta'); return; }
        BelenUI.modal({
            titulo: 'Asignar cama', subtitulo: t.paciente_nombre + ' · ' + S.nombreAreaEstancia(area), icono: 'fa-bed', ancho: 'sm',
            html: `<label for="cama-valor" class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Cama disponible en ${e(S.nombreAreaEstancia(area))}</label>
                ${libres.length ? `<select id="cama-valor" class="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white">${libres.map(c => `<option value="${e(c.codigo)}">${e(c.nombre)}</option>`).join('')}</select>` : '<p class="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">No hay camas libres en esta área.</p>'}
                <p class="text-[11px] text-slate-500 mt-2">La misma cifra en otra zona es otra cama. Hospitalización, Observación y Recuperación no se pisan.</p>
                <p id="cama-error" class="text-[11px] text-red-600 mt-1 hidden"></p>`,
            botones: [
                { texto: 'Cancelar', estilo: 'secundario' },
                { texto: 'Guardar cama', estilo: 'primario', id: 'cama-guardar', alPulsar: c => {
                    const sel = c.el.querySelector('#cama-valor');
                    if (!sel) { BelenUI.toast('No hay camas libres en esta área.', 'alerta'); return false; }
                    const r = S.asignarCama(turnoId, sel.value, this.sesion);
                    if (!r.ok) { const m = c.el.querySelector('#cama-error'); m.textContent = r.motivo; m.classList.remove('hidden'); return false; }
                    BelenUI.toast(r.internamiento.cama + ' asignada a ' + t.paciente_nombre + '.', 'exito');
                    this.render();
                } }
            ]
        });
    },

    abrirCambiarArea: function (turnoId) {
        const S = BelenStore, t = S.obtenerTurno(turnoId);
        if (!t || !S.puedeCambiarArea(this.sesion)) { BelenUI.toast('Su perfil no puede cambiar el área.', 'alerta'); return; }
        const i = S.internamientoDeTurno(turnoId);
        const actual = S.codigoAreaEstancia(i, t);
        const destinos = S.areasDestinoEstancia(actual);
        if (!destinos.length) { BelenUI.aviso('Sin cambio de área', 'Desde ' + (S.nombreAreaEstancia(actual) || 'esta área') + ' no hay un pase a Observación o Hospitalización.', 'info'); return; }
        const e = x => this.e(x);
        const opcionesArea = destinos.map(d => `<option value="${d}">${e(S.nombreAreaEstancia(d))}</option>`).join('');
        BelenUI.modal({
            titulo: 'Cambiar Área de Estancia', subtitulo: t.paciente_nombre, icono: 'fa-right-left', ancho: 'md',
            html: `<div class="space-y-3 text-left">
                <p class="text-xs text-slate-500">Sale de <b>${e(S.nombreAreaEstancia(actual) || 'sin área')}</b> y libera ${e(S.etiquetaCama(i && (i.cama_codigo || i.cama)) || 'la cama anterior')}.</p>
                <label class="block text-[11px] font-bold text-slate-500 uppercase">Nueva área</label>
                <select id="area-nueva" class="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white">${opcionesArea}</select>
                <label class="block text-[11px] font-bold text-slate-500 uppercase">Cama en la nueva zona</label>
                <select id="area-cama" class="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white"></select>
                <p id="area-error" class="text-[11px] text-red-600 hidden"></p>
            </div>`,
            alMostrar: c => {
                const area = c.el.querySelector('#area-nueva');
                const cama = c.el.querySelector('#area-cama');
                const pintar = () => {
                    const libres = S.camasLibres(area.value, i && i.internamiento_id);
                    cama.innerHTML = libres.length ? libres.map(x => `<option value="${e(x.codigo)}">${e(x.nombre)}</option>`).join('') : '<option value="">Sin camas libres</option>';
                };
                area.addEventListener('change', pintar);
                pintar();
            },
            botones: [
                { texto: 'Cancelar', estilo: 'secundario' },
                { texto: 'Cambiar área', estilo: 'primario', alPulsar: c => {
                    const error = c.el.querySelector('#area-error');
                    const codigo = c.el.querySelector('#area-cama').value;
                    if (!codigo) { error.textContent = 'Elija una cama libre de la nueva zona.'; error.classList.remove('hidden'); return false; }
                    const r = S.cambiarAreaEstancia(turnoId, c.el.querySelector('#area-nueva').value, codigo, this.sesion);
                    if (!r.ok) { error.textContent = r.motivo; error.classList.remove('hidden'); return false; }
                    BelenUI.toast(t.paciente_nombre + ' pasó a ' + r.internamiento.cama + '.', 'exito');
                    this.render();
                } }
            ]
        });
    },

    abrirCorteEstancia: function (turnoId) {
        const S = BelenStore;
        if (this.rolActual !== 'admin' && this.rolActual !== 'administrador') { BelenUI.toast('Solo administración y caja aplican el corte de estancia.', 'alerta'); return; }
        const prev = S.previewCorteEstancia(turnoId);
        if (!prev.ok) { BelenUI.aviso('Corte de estancia', prev.motivo, 'alerta'); return; }
        const e = x => this.e(x);
        BelenUI.modal({
            titulo: 'Aplicar Corte de Estancia / Noche', subtitulo: prev.area_nombre, icono: 'fa-bed', ancho: 'sm',
            html: `<div class="space-y-3 text-left">
                <p class="text-sm text-slate-700">Se cargará <b>${e(prev.concepto)}</b> a la cuenta. Puede confirmar el importe del tarifario o ajustarlo.</p>
                <label class="block text-[11px] font-bold text-slate-500 uppercase">Importe</label>
                <input id="corte-precio" type="number" min="0.01" step="0.01" value="${prev.precio}" class="w-full border border-slate-300 rounded-lg p-2.5 text-sm">
                <p id="corte-error" class="text-[11px] text-red-600 hidden"></p>
            </div>`,
            botones: [
                { texto: 'Cancelar', estilo: 'secundario' },
                { texto: 'Cargar corte', estilo: 'primario', alPulsar: c => {
                    const r = S.aplicarCorteEstancia(turnoId, { precio: c.el.querySelector('#corte-precio').value }, this.sesion);
                    const error = c.el.querySelector('#corte-error');
                    if (!r.ok) { error.textContent = r.motivo; error.classList.remove('hidden'); return false; }
                    BelenUI.toast(prev.concepto + ' cargado a la cuenta.', 'exito');
                    this.render();
                } }
            ]
        });
    },

    liberarPreCobroFila: function (turnoId) {
        const S = BelenStore, t = S.obtenerTurno(turnoId);
        if (!t) return;
        const r = S.liberarConsultaACaja(turnoId, this.sesion);
        if (!r || !r.ok) { BelenUI.toast((r && r.motivo) || 'No se pudo enviar a Caja.', 'alerta'); return; }
        BelenUI.toast(t.paciente_nombre + ' disponible en Caja para pre-cobro de consulta.', 'exito');
        this.abrirDesgloseCuenta(turnoId);
    },

    abrirConfirmarCirugiaAdmin: function (cirugiaId) { return this.abrirDetalleCirugiaCalendario(cirugiaId); }, _legacyConfirmarQx: function (cirugiaId) {
        const S = BelenStore, c = S.cirugiaPara(cirugiaId, this.sesion);
        if (!c) { BelenUI.toast('No se encontró la cirugía.', 'alerta'); return; }
        const e = x => this.e(x);
        const anests = S.anestesiologos();
        const cls = 'w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white';
        BelenUI.modal({
            titulo: 'Confirmar Cirugía y Equipo Quirúrgico',
            subtitulo: c.nombre + ' · ' + c.procedimiento,
            icono: 'fa-user-check',
            ancho: 'lg',
            html: `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
                <div class="sm:col-span-2 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-700">
                    <b>Cirujano titular:</b> ${e(c.cirujano)} · <b>Sala actual:</b> ${e(c.sala_nombre)} · <b>Horario:</b> ${e(c.fecha_texto)} ${e(c.hora_texto)}
                </div>
                <div>
                    <label class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Anestesiólogo del hospital</label>
                    <select id="conf-qx-anest-id" class="${cls}">
                        <option value="">— Seleccionar o escribir abajo —</option>
                        ${anests.map(a => `<option value="${e(a.id)}" ${c.anestesiologo_id === a.id ? 'selected' : ''}>${e(a.nombre)}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Anestesiólogo externo (si aplica)</label>
                    <input id="conf-qx-anest-txt" type="text" value="${e(!c.anestesiologo_id && !c.anestesiologo_pendiente ? c.anestesiologo : '')}" placeholder="Dr. / Dra. Anestesiólogo" class="${cls}">
                </div>
                <div>
                    <label class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Primer Ayudante</label>
                    <input id="conf-qx-ayudante" type="text" value="${e(c.ayudante_nombre || '')}" placeholder="Ej. Dr. Jorge Luis López" class="${cls}">
                </div>
                <div>
                    <label class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Instrumentista</label>
                    <input id="conf-qx-inst" type="text" value="${e(c.instrumentista_nombre || '')}" placeholder="Ej. Enf. Quirúrgica / Instrumentista" class="${cls}">
                </div>
                <div>
                    <label class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Enfermera Circulante</label>
                    <input id="conf-qx-circ" type="text" value="${e(c.circulante_nombre || '')}" placeholder="Ej. L.E. Valeria Cruz" class="${cls}">
                </div>
                <div>
                    <label class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Sala Quirúrgica</label>
                    <select id="conf-qx-sala" class="${cls}">
                        ${(S.SALAS_QUIROFANO || []).map(s => `<option value="${e(s.codigo)}" ${c.sala_codigo === s.codigo ? 'selected' : ''}>${e(s.nombre)}</option>`).join('')}
                    </select>
                </div>
                <div class="sm:col-span-2">
                    <label class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Notas de confirmación administrativa / insumos requeridos</label>
                    <input id="conf-qx-notas" type="text" value="${e(c.notas_confirmacion || '')}" placeholder="Ej. Confirmado con cirujano y anestesiólogo, paquete listo en CEYE" class="${cls}">
                </div>
                <p id="conf-qx-err" class="sm:col-span-2 text-xs text-red-600 hidden"></p>
            </div>`,
            botones: [
                { texto: 'Cancelar', estilo: 'secundario' },
                { texto: '✅ Confirmar Cirugía y Guardar Equipo', estilo: 'exito', alPulsar: m => {
                    const q = id => m.el.querySelector('#' + id).value;
                    const r = S.confirmarCirugiaAdmin(cirugiaId, {
                        anestesiologo_id: q('conf-qx-anest-id'),
                        anestesiologo_nombre: q('conf-qx-anest-txt'),
                        ayudante_nombre: q('conf-qx-ayudante'),
                        instrumentista_nombre: q('conf-qx-inst'),
                        circulante_nombre: q('conf-qx-circ'),
                        sala: q('conf-qx-sala'),
                        notas_confirmacion: q('conf-qx-notas')
                    }, this.sesion);
                    if (!r || !r.ok) {
                        const err = m.el.querySelector('#conf-qx-err');
                        err.textContent = (r && r.motivo) || 'No se pudo confirmar la cirugía.';
                        err.classList.remove('hidden');
                        return false;
                    }
                    BelenUI.toast('Cirugía y equipo quirúrgico confirmados por Administración.', 'exito');
                    this.render();
                } }
            ]
        });
    },

    alternarMapa2D: function () {
        this.mostrarMapa2D = !this.mostrarMapa2D;
        this.render();
    },

    iniciarMoverEnPlano: function (turnoId) {
        this.pacienteMoverPlanoId = turnoId || '';
        if (this.pacienteMoverPlanoId) {
            const t = BelenStore.obtenerTurno(this.pacienteMoverPlanoId);
            BelenUI.toast('Seleccione en el Plano 2D la habitación o espacio destino para ' + ((t && t.paciente_nombre) || 'el paciente') + '.', 'info');
        }
        this.render();
    },

    urlExpedientePaciente: function (turnoId) {
        const S = BelenStore;
        const t = S.obtenerTurno(turnoId);
        const i = S.resolverInternamiento(turnoId);
        const enHosp = !!(i && (!t || t.estatus === 'internado' || t.estatus === 'alta_medica_pendiente_pago' || t.estatus === 'cerrado_historico' || i.sin_nota_consulta));
        return enHosp
            ? 'expediente.html?modo=hospitalizado&turno=' + encodeURIComponent(turnoId)
            : 'expediente.html?turno=' + encodeURIComponent(turnoId);
    },

    seleccionarEspacioPlano: function (camaCodigo) {
        const S = BelenStore, e = x => this.e(x);
        const camaDef = (S.CAMAS_HOSPITAL || []).find(c => c.codigo === camaCodigo);
        if (!camaDef) return;
        const ocupantes = this.ocupantesPorCamaMapa()[camaCodigo] || [];

        // Si estamos en modo "Mover paciente seleccionado"
        if (this.pacienteMoverPlanoId) {
            const turnoMover = S.obtenerTurno(this.pacienteMoverPlanoId);
            if (!turnoMover) { this.pacienteMoverPlanoId = ''; this.render(); return; }
            const r = S.moverPacienteEnPlano(this.pacienteMoverPlanoId, camaCodigo, this.sesion);
            if (!r || !r.ok) {
                BelenUI.toast((r && r.motivo) || 'No se pudo ubicar al paciente en esa cama.', 'alerta');
                return;
            }
            this.pacienteMoverPlanoId = '';
            BelenUI.toast(turnoMover.paciente_nombre + ' ubicado en ' + camaDef.nombre + '.', 'exito');
            this.render();
            return;
        }

        // Si la cama tiene 1 paciente con acceso al expediente y el usuario no puede asignar cama, ir directo al expediente
        if (ocupantes.length === 1 && ocupantes[0].puede_abrir && !S.puede('asignar_cama')) {
            window.location.href = this.urlExpedientePaciente(ocupantes[0].turno_id);
            return;
        }

        const todosMovibles = this.pacientesMoviblesEnPlano();
        const htmlOcupantes = ocupantes.length
            ? ocupantes.map(o => `<div class="bg-indigo-50 border border-indigo-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <p class="font-extrabold text-slate-900 text-sm"><i class="fas fa-user-injured text-indigo-600 mr-1"></i>${e(o.nombre)}</p>
                    <p class="text-xs text-slate-600">${e(o.detalle || '')} · Dr(a). ${e(o.medico || '')}</p>
                </div>
                <div class="flex flex-wrap gap-1.5">
                    ${o.puede_abrir ? `<a href="${this.urlExpedientePaciente(o.turno_id)}" class="bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold px-3 py-1.5 rounded-lg inline-flex items-center gap-1"><i class="fas fa-folder-open"></i> Abrir Expediente</a>` : ''}
                    ${S.puede('asignar_cama') ? `<button type="button" data-mover-este="${e(o.turno_id)}" class="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg"><i class="fas fa-arrows-up-down-left-right mr-1"></i>Cambiar cama</button>` : ''}
                </div>
            </div>`).join('')
            : `<div class="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-900 font-semibold flex items-center gap-2">
                <i class="fas fa-circle-check text-emerald-600 text-base"></i> Cama disponible actualmente.
            </div>`;

        const selectorAsignar = (S.puede('asignar_cama') && todosMovibles.length)
            ? `<div class="mt-4 pt-3 border-t border-slate-200">
                <label class="block text-[11px] font-extrabold text-slate-500 uppercase mb-1">Asignar o mover paciente a ${e(camaDef.nombre)}</label>
                <div class="flex gap-2">
                    <select id="plano-sel-pac" class="flex-1 border border-slate-300 rounded-lg p-2 text-sm bg-white">
                        <option value="">— Seleccionar paciente —</option>
                        ${todosMovibles.map(p => `<option value="${e(p.turno_id)}">${e(p.nombre)} (${e(p.ubicacion_actual)})</option>`).join('')}
                    </select>
                    <button type="button" id="plano-btn-ubicar" class="bg-cyan-700 hover:bg-cyan-800 text-white text-xs font-extrabold px-4 py-2 rounded-lg shrink-0">Asignar aquí</button>
                </div>
            </div>` : '';

        BelenUI.modal({
            titulo: camaDef.nombre,
            subtitulo: `Código: ${camaDef.codigo} · Zona: ${S.nombreAreaEstancia(camaDef.area) || camaDef.area}`,
            icono: 'fa-bed',
            ancho: 'md',
            html: `<div class="space-y-3 text-left">${htmlOcupantes}${selectorAsignar}</div>`,
            alMostrar: m => {
                m.el.querySelectorAll('[data-mover-este]').forEach(b => b.addEventListener('click', () => {
                    const tid = b.getAttribute('data-mover-este');
                    m.cerrar();
                    this.iniciarMoverEnPlano(tid);
                }));
                const btnUbicar = m.el.querySelector('#plano-btn-ubicar');
                if (btnUbicar) {
                    btnUbicar.addEventListener('click', () => {
                        const tid = m.el.querySelector('#plano-sel-pac').value;
                        if (!tid) { BelenUI.toast('Seleccione un paciente de la lista.', 'alerta'); return; }
                        const r = S.moverPacienteEnPlano(tid, camaCodigo, this.sesion);
                        if (!r || !r.ok) { BelenUI.toast((r && r.motivo) || 'No se pudo mover al paciente.', 'alerta'); return; }
                        m.cerrar();
                        BelenUI.toast('Paciente ubicado en ' + camaDef.nombre + '.', 'exito');
                        this.render();
                    });
                }
            },
            botones: [{ texto: 'Cerrar', estilo: 'secundario' }]
        });
    },

    abrirPlanoArquitectonicoOriginal: function () {
        BelenUI.modal({
            titulo: 'Plano Arquitectónico de Referencia — Sanatorio Belén',
            subtitulo: 'Imágenes del plano físico de planta baja (5 Habitaciones, Quirófano, Cunero y Consulta Externa)',
            icono: 'fa-image',
            ancho: 'xl',
            html: `<div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
                <div class="border border-slate-200 rounded-xl p-2 bg-slate-50">
                    <p class="text-xs font-extrabold text-slate-700 mb-2">📐 Plano Arquitectónico General</p>
                    <a href="assets/plano-arquitectonico.jpg" target="_blank" class="block">
                        <img src="assets/plano-arquitectonico.jpg" alt="Plano Arquitectónico Sanatorio Belén" class="w-full rounded-lg border border-slate-300 shadow-sm">
                    </a>
                </div>
                <div class="border border-slate-200 rounded-xl p-2 bg-slate-50">
                    <p class="text-xs font-extrabold text-slate-700 mb-2">🔍 Detalle de Áreas</p>
                    <a href="assets/plano-arquitectonico-detalle.jpg" target="_blank" class="block">
                        <img src="assets/plano-arquitectonico-detalle.jpg" alt="Detalle Plano Arquitectónico Sanatorio Belén" class="w-full rounded-lg border border-slate-300 shadow-sm">
                    </a>
                </div>
            </div>`,
            botones: [{ texto: 'Cerrar', estilo: 'secundario' }]
        });
    },

    pacientesMoviblesEnPlano: function () {
        const S = BelenStore, s = this.sesion;
        const res = [];
        const vistos = {};
        (S.hospitalizadosDe(s) || []).forEach(t => {
            if (t.estatus === 'alta' || t.estatus === 'cerrado_historico') return;
            const i = S.internamientoDeTurno(t.turno_id);
            const cama = (i && (i.cama || i.cama_codigo)) || t.cama || 'Sin cama';
            vistos[t.turno_id] = true;
            res.push({ turno_id: t.turno_id, nombre: t.paciente_nombre, ubicacion_actual: cama, medico: t.medico_nombre });
        });
        return res;
    },

    ocupantesPorCamaMapa: function () {
        const S = BelenStore, s = this.sesion;
        const mapa = {};
        const visiblesSet = {};
        (S.hospitalizadosDe(s) || []).forEach(t => { visiblesSet[t.turno_id] = true; });
        const poner = (cod, obj) => {
            const norm = S.normalizarCodigoCama(cod);
            if (!norm) return;
            if (!mapa[norm]) mapa[norm] = [];
            if (!mapa[norm].some(x => x.turno_id === obj.turno_id)) mapa[norm].push(obj);
        };
        // Mostrar la ocupación real de todas las camas hospitalarias para que ningún perfil vea como "Libre" una cama ocupada
        (S.listarInternamientos() || []).forEach(i => {
            if (!i || i.estatus === 'egresado') return;
            const t = S.obtenerTurno(i.turno_id);
            if (!t || t.estatus === 'alta' || t.estatus === 'cerrado_historico') return;
            const cod = i.cama_codigo || i.cama || t.cama_codigo || t.cama;
            if (!cod) return;
            const puedeVer = !!visiblesSet[t.turno_id] || s.rol === 'admin' || s.rol === 'administrador' || s.rol === 'enf_hospital';
            if (!puedeVer) { poner(cod, { turno_id: t.turno_id, reservado: true, puede_abrir: false }); return; }
            const f = S.fichaHospitalizado(t, s);
            poner(cod, {
                turno_id: t.turno_id,
                nombre: puedeVer ? f.nombre : t.paciente_nombre,
                medico: f.medico_tratante || t.medico_nombre,
                especialidad: f.especialidad || t.especialidad || '',
                diagnostico: f.diagnostico_actual || i.diagnostico_actual || t.dx_principal || '',
                detalle: (f.edad !== null ? f.edad + ' años' : '') + (f.diagnostico_actual ? ' · ' + f.diagnostico_actual : ''),
                alergias: f.alergias || i.alergias || '',
                pendiente_pago: !!f.pendiente_pago,
                puede_abrir: puedeVer
            });
        });
        return mapa;
    },

    htmlMapaArquitectonico2D: function () {
        const S = BelenStore, e = x => this.e(x);
        const ocupantes = this.ocupantesPorCamaMapa();
        const movibles = this.pacientesMoviblesEnPlano();
        const enModoMover = !!this.pacienteMoverPlanoId;
        const turnoMover = enModoMover ? S.obtenerTurno(this.pacienteMoverPlanoId) : null;
        const puedeAsignar = S.puede('asignar_cama');

        const tarjetaCama = (codigo, tituloCorto, subtitulo, icono, esAislado) => {
            const lista = ocupantes[codigo] || [];
            const ocupado = lista.length > 0;
            const pac = lista[0];

            if (enModoMover) {
                return `<div data-plano-cama="${e(codigo)}" onclick="AdminController.seleccionarEspacioPlano('${e(codigo)}')"
                    class="rounded-2xl p-3.5 border-2 border-dashed border-cyan-500 bg-cyan-50/60 hover:bg-cyan-100/70 cursor-pointer transition flex flex-col justify-between min-h-[132px]">
                    <div class="flex items-center justify-between gap-2">
                        <span class="text-xs font-extrabold text-slate-800"><i class="fas ${icono} mr-1 text-cyan-700"></i>${e(tituloCorto)}</span>
                        <span class="text-[10px] font-mono font-bold text-slate-500">${e(codigo)}</span>
                    </div>
                    <p class="text-xs font-extrabold text-cyan-900 mt-2">${ocupado ? (pac.reservado ? 'Ocupada' : 'Ocupada por ' + e(pac.nombre)) : '👉 Clic aquí para ubicar al paciente'}</p>
                </div>`;
            }

            if (ocupado && pac.reservado) {
                return `<div data-plano-cama="${e(codigo)}" class="rounded-2xl p-3.5 border border-slate-300 bg-slate-100 flex flex-col justify-between min-h-[120px]">
                    <div class="flex items-center justify-between gap-1.5">
                        <span class="text-sm font-extrabold text-slate-700"><i class="fas ${icono} mr-1.5 text-slate-400"></i>${e(tituloCorto)}</span>
                        <span class="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-slate-400 text-white">Ocupada</span>
                    </div>
                    <p class="text-xs text-slate-500 mt-3"><i class="fas fa-lock mr-1"></i>Cama ocupada · información reservada al personal del área</p>
                </div>`;
            }
            if (ocupado) {
                const urlExp = this.urlExpedientePaciente(pac.turno_id);
                const borde = pac.pendiente_pago
                    ? 'border-2 border-amber-500 bg-amber-50/70'
                    : (pac.puede_abrir ? 'border-2 border-indigo-600 bg-white' : 'border border-slate-300 bg-slate-50');
                const badge = pac.pendiente_pago
                    ? '<span class="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-amber-600 text-white">Alta · Por cobrar</span>'
                    : (pac.puede_abrir
                        ? '<span class="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-indigo-600 text-white">Ocupada</span>'
                        : '<span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">Otro servicio</span>');

                return `<div data-plano-cama="${e(codigo)}" class="rounded-2xl p-3.5 shadow-sm transition flex flex-col justify-between min-h-[148px] ${borde}">
                    <div>
                        <div class="flex items-center justify-between gap-1.5">
                            <span class="text-xs font-extrabold text-slate-800"><i class="fas ${icono} mr-1.5 ${esAislado ? 'text-rose-600' : 'text-indigo-600'}"></i>${e(tituloCorto)}</span>
                            ${badge}
                        </div>
                        <div class="mt-2 pt-2 border-t border-slate-200/80">
                            <p class="text-sm font-extrabold text-slate-900 leading-snug" title="${e(pac.nombre)}">${e(pac.nombre)}</p>
                            <p class="text-[11px] font-semibold text-slate-600 mt-0.5">Dr(a). ${e(pac.medico || 'Asignado')}</p>
                            ${pac.diagnostico ? `<p class="text-[11px] text-slate-500 truncate mt-0.5" title="${e(pac.diagnostico)}">${e(pac.diagnostico)}</p>` : ''}
                        </div>
                    </div>
                    <div class="mt-3 pt-2 border-t border-slate-100 flex items-center gap-1.5">
                        ${pac.puede_abrir
                            ? `<a href="${urlExp}" data-accion="abrir-expediente-cama" class="flex-1 bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold py-2 px-3 rounded-xl text-center transition flex items-center justify-center gap-1.5 shadow-sm"><i class="fas fa-folder-open"></i> Abrir Expediente</a>`
                            : `<span class="flex-1 text-[11px] font-semibold text-slate-500 text-center py-1.5 bg-slate-100 rounded-lg">A cargo de ${e(pac.medico || 'otro médico')}</span>`}
                        ${puedeAsignar ? `<button type="button" onclick="AdminController.seleccionarEspacioPlano('${e(codigo)}')" title="Cambiar cama o gestionar espacio" class="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold py-2 px-2.5 rounded-xl transition"><i class="fas fa-arrows-up-down-left-right"></i></button>` : ''}
                    </div>
                </div>`;
            }

            // Cama Libre
            return `<div data-plano-cama="${e(codigo)}" ${puedeAsignar ? `onclick="AdminController.seleccionarEspacioPlano('${e(codigo)}')"` : ''}
                class="rounded-2xl p-3.5 border border-emerald-200 bg-emerald-50/40 ${puedeAsignar ? 'hover:bg-emerald-50 hover:border-emerald-400 cursor-pointer' : ''} transition flex flex-col justify-between min-h-[120px]">
                <div>
                    <div class="flex items-center justify-between gap-1.5">
                        <span class="text-xs font-extrabold text-slate-800"><i class="fas ${icono} mr-1.5 ${esAislado ? 'text-rose-600' : 'text-emerald-600'}"></i>${e(tituloCorto)}</span>
                        <span class="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">Disponible</span>
                    </div>
                    <p class="text-[11px] text-slate-500 mt-1">${e(subtitulo)}</p>
                </div>
                <div class="mt-2 pt-2 border-t border-emerald-200/50 flex items-center justify-between">
                    <span class="text-[10px] font-mono font-bold text-slate-400">${e(codigo)}</span>
                    ${puedeAsignar ? '<span class="text-[11px] font-bold text-emerald-700">+ Asignar paciente</span>' : '<span class="text-[11px] text-emerald-700 font-medium">Sin paciente</span>'}
                </div>
            </div>`;
        };

        const barraMover = (puedeAsignar && movibles.length) ? `<div class="mb-4 bg-slate-900 text-white rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-2 text-xs">
                <i class="fas fa-bed text-cyan-400 text-sm"></i>
                ${enModoMover
                    ? `<span><b>Modo cambio de cama:</b> haga clic en la cama destino para ubicar a <b class="text-cyan-300">${e((turnoMover && turnoMover.paciente_nombre) || '')}</b>.</span>`
                    : `<span><b>Cambio rápido de cama:</b> puede abrir cualquier expediente en 1 clic o reubicar un paciente de cama.</span>`}
            </div>
            <div class="flex flex-wrap items-center gap-2">
                <select onchange="AdminController.iniciarMoverEnPlano(this.value)" class="bg-slate-800 border border-slate-600 text-white text-xs rounded-lg px-2.5 py-1.5">
                    <option value="">— Mover paciente a otra cama —</option>
                    ${movibles.map(p => `<option value="${e(p.turno_id)}" ${this.pacienteMoverPlanoId === p.turno_id ? 'selected' : ''}>${e(p.nombre)} (${e(p.ubicacion_actual)})</option>`).join('')}
                </select>
                ${enModoMover ? `<button type="button" onclick="AdminController.iniciarMoverEnPlano('')" class="bg-red-600 hover:bg-red-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg">Cancelar</button>` : ''}
            </div>
        </div>` : '';

        const todasCamas = ['HOSP-1','HOSP-2','HOSP-3','HOSP-4','HOSP-AISLADO','CUNERO-1','REC-1','REC-2','REC-GINECO','OBS-1','OBS-2'];
        const nOcup = todasCamas.filter(c => (ocupantes[c] || []).length).length;
        const nMios = todasCamas.filter(c => (ocupantes[c] || []).some(p => p.puede_abrir)).length;
        const nCobro = todasCamas.filter(c => (ocupantes[c] || []).some(p => p.pendiente_pago)).length;
        const chip = (n, txt, cls) => `<div class="flex-1 min-w-[120px] rounded-xl px-3 py-2 ${cls}"><div class="text-2xl font-black leading-none">${n}</div><div class="text-[11px] font-bold uppercase tracking-wide mt-1">${txt}</div></div>`;
        const resumen = `<div class="flex flex-wrap gap-2 mb-3">
                ${chip(todasCamas.length - nOcup, 'Camas libres', 'bg-emerald-50 text-emerald-800 border border-emerald-200')}
                ${chip(nMios, (this.sesion.rol === 'admin' || this.sesion.rol === 'administrador' || this.sesion.rol === 'enf_hospital') ? 'Ocupadas' : 'Mis pacientes', 'bg-indigo-50 text-indigo-800 border border-indigo-200')}
                ${nOcup - nMios > 0 ? chip(nOcup - nMios, 'Ocupadas (otro servicio)', 'bg-slate-100 text-slate-700 border border-slate-200') : ''}
                ${nCobro ? chip(nCobro, 'Alta por cobrar', 'bg-amber-50 text-amber-800 border border-amber-200') : ''}
            </div>
            <div class="flex flex-wrap items-center gap-4 text-[11px] text-slate-600 mb-4 pb-3 border-b border-slate-100">
                <span><span class="inline-block w-3 h-3 rounded bg-emerald-300 mr-1 align-middle"></span>Libre</span>
                <span><span class="inline-block w-3 h-3 rounded bg-indigo-600 mr-1 align-middle"></span>Ocupada (puede abrir)</span>
                <span><span class="inline-block w-3 h-3 rounded bg-slate-400 mr-1 align-middle"></span>Ocupada (reservada)</span>
                <span><span class="inline-block w-3 h-3 rounded bg-amber-500 mr-1 align-middle"></span>Alta por cobrar</span>
            </div>`;
        return `<section id="mapa-arquitectonico-2d" class="mb-6 bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5">
            ${barraMover}
            ${resumen}
            <div class="mb-5">
                <div class="flex items-center justify-between mb-2.5">
                    <h3 class="text-xs font-extrabold uppercase tracking-wider text-indigo-950 flex items-center gap-1.5">
                        <i class="fas fa-bed text-indigo-600"></i> Hospitalización en Piso (5 Habitaciones + Cunero)
                    </h3>
                    <span class="text-[11px] text-slate-500">1 clic en <b>Abrir Expediente</b> para entrar directo</span>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    ${tarjetaCama('HOSP-1', 'Habitación 1', 'Hospitalización Estándar', 'fa-bed', false)}
                    ${tarjetaCama('HOSP-2', 'Habitación 2', 'Hospitalización Estándar', 'fa-bed', false)}
                    ${tarjetaCama('HOSP-3', 'Habitación 3', 'Hospitalización Estándar', 'fa-bed', false)}
                    ${tarjetaCama('HOSP-4', 'Habitación 4', 'Hospitalización Estándar', 'fa-bed', false)}
                    ${tarjetaCama('HOSP-AISLADO', 'Habitación Aislada', 'Aislamiento con baño privado', 'fa-shield-virus', true)}
                    ${tarjetaCama('CUNERO-1', 'Cunero', 'Recién Nacidos / Incubadora', 'fa-baby', false)}
                </div>
            </div>

            <div>
                <div class="flex items-center justify-between mb-2.5">
                    <h3 class="text-xs font-extrabold uppercase tracking-wider text-violet-950 flex items-center gap-1.5">
                        <i class="fas fa-bed-pulse text-violet-600"></i> Recuperación Post-Quirúrgica y Observación
                    </h3>
                    <span class="text-[11px] text-slate-500">Camillas de corta estancia y post-operatorio</span>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                    ${tarjetaCama('REC-1', 'Recuperación 1', 'Post-Quirúrgica', 'fa-bed-pulse', false)}
                    ${tarjetaCama('REC-2', 'Recuperación 2', 'Valoración / Post-Qx', 'fa-bed-pulse', false)}
                    ${tarjetaCama('REC-GINECO', 'Rec. Gineco', 'Preparación / Expulsión', 'fa-bed-pulse', false)}
                    ${tarjetaCama('OBS-1', 'Observación 1', 'Hidratación / Corta estancia', 'fa-droplet', false)}
                    ${tarjetaCama('OBS-2', 'Observación 2', 'Curaciones / Urgencias', 'fa-bandage', false)}
                </div>
            </div>
        </section>`;
    },

    // ======================================================================
    // VISTA: FARMACIA E INVENTARIO
    // ======================================================================
    esKioscoFarmacia: function () { return this.rolActual === 'enf_farmacia'; },
    sesionPersonalFarmacia: function () { return this.rolActual === 'admin' || this.rolActual === 'administrador'; },

    operadorFarmacia: function () {
        if (this.sesionPersonalFarmacia()) return BelenStore.USUARIOS[this.sesion.usuario_id] || null;
        return this.operadorFarmaciaId ? BelenStore.USUARIOS[this.operadorFarmaciaId] : null;
    },

    contextoOperadorFarmacia: function () {
        const op = this.operadorFarmacia();
        return op ? { usuario_id: op.id, rol: op.rol, nombre: op.nombre } : null;
    },

    pintarBarraKiosco: function () {
        const aside = document.getElementById('sidebar-principal') || document.querySelector('aside');
        const btnMenu = document.getElementById('btn-abrir-sidebar');
        const bottomNav = document.getElementById('mobile-bottom-nav');
        const cerrar = document.getElementById('kiosco-cerrar');
        const barra = document.getElementById('kiosco-operador');
        const kiosco = this.esKioscoFarmacia();
        if (aside) aside.classList.toggle('!hidden', kiosco);
        if (btnMenu) btnMenu.classList.toggle('!hidden', kiosco);
        if (bottomNav) bottomNav.classList.toggle('!hidden', kiosco);
        if (cerrar) cerrar.classList.toggle('hidden', !kiosco);
        if (!barra) return;
        const op = kiosco ? this.operadorFarmacia() : null;
        if (!op) { barra.className = 'hidden'; barra.innerHTML = ''; return; }
        const cedula = op.cedula_profesional || 'Sin cédula';
        barra.className = 'flex flex-wrap items-center gap-3';
        barra.innerHTML = `<p class="text-sm font-extrabold text-emerald-900">Operando como: ${this.e(op.nombre)} (${this.e(op.cargo)} - Cédula: ${this.e(cedula)})</p>
            <button type="button" onclick="AdminController.cerrarTurnoFarmacia()" class="bg-red-600 hover:bg-red-500 text-white text-xs font-bold px-3 py-2 rounded-lg">Terminar turno / Bloquear terminal</button>`;
    },

    pestanasVisiblesFarmacia: function () {
        const op = this.operadorFarmacia();
        const tabs = [['terminal', 'Cargar a Paciente'], ['recetas', 'Archivo Digital de Recetas'], ['inventario', 'Inventario / Almacén']];
        if (!op) return tabs;
        const puede = accion => BelenStore.permisoAccionDe(op.id, accion);
        if (puede('farmacia_paquetes')) tabs.push(['paquetes', 'Paquetes y Kits']);
        if (puede('farmacia_estupefacientes') || op.rol === 'administrador' || op.rol === 'enf_farmacia') tabs.push(['estupefacientes', 'Estupefacientes Fracción I']);
        if (puede('ver_bitacora_farmacia')) tabs.push(['bitacora', 'Bitácora de Entradas y Salidas']);
        return tabs;
    },

    cambiarPestanaFarmacia: function (pestana) {
        const ok = this.pestanasVisiblesFarmacia().map(t => t[0]);
        this.pestanaFarmacia = ok.indexOf(pestana) >= 0 ? pestana : 'terminal';
        this.render();
    },

    htmlIdentidadFarmacia: function () { return ''; },

    entrarKioscoFarmacia: function () {
        const input = document.getElementById('kiosco-codigo');
        const r = BelenStore.identificarOperadorFarmacia(input ? input.value : '');
        if (!r.ok) { BelenUI.toast(r.motivo, 'alerta'); if (input) { input.focus(); input.select(); } return; }
        this.operadorFarmaciaId = r.usuario.id;
        this.modoRetiroAdmin = false;
        BelenUI.toast('Turno de ' + r.usuario.nombre + '.', 'exito');
        this.render();
    },

    cerrarTurnoFarmacia: function () {
        this.operadorFarmaciaId = null;
        this.pacienteCargoId = null;
        this.modoRetiroAdmin = false;
        this.carritoFarmacia = [];
        this.render();
    },

    htmlFarmacia: function () {
        const S = BelenStore;
        const visibles = this.pestanasVisiblesFarmacia();
        if (!visibles.some(t => t[0] === this.pestanaFarmacia)) this.pestanaFarmacia = 'terminal';
        const tab = (id, txt) => {
            const on = this.pestanaFarmacia === id;
            return `<button type="button" onclick="AdminController.cambiarPestanaFarmacia('${id}')" class="px-4 py-2 rounded-lg text-sm font-bold transition ${on ? 'bg-white text-teal-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}">${txt}</button>`;
        };
        const cuerpos = { terminal: () => this.htmlTerminalFarmacia(), recetas: () => this.htmlArchivoRecetas(), inventario: () => this.htmlInventarioFarmacia(), paquetes: () => this.htmlPaquetesFarmacia(), estupefacientes: () => this.htmlEstupefacientesFarmacia(), bitacora: () => this.htmlBitacoraFarmacia() };
        const cuerpo = (cuerpos[this.pestanaFarmacia] || cuerpos.terminal)();
        const ingreso = this.pestanaFarmacia === 'inventario' && this.operadorFarmacia() && S.puede('gestionar_farmacia')
            ? '<button type="button" onclick="AdminController.abrirIngresoFarmacia()" class="bg-teal-700 hover:bg-teal-800 text-white text-sm font-bold py-2.5 px-4 rounded-lg shadow-sm transition flex items-center gap-2"><i class="fas fa-plus"></i> Nuevo ingreso de insumo</button>' : '';
        const nuevoPaq = this.pestanaFarmacia === 'paquetes' && this.operadorFarmacia() && S.puede('gestionar_farmacia')
            ? '<button type="button" onclick="AdminController.abrirEditorPaquete()" class="bg-teal-700 hover:bg-teal-800 text-white text-sm font-bold py-2.5 px-4 rounded-lg shadow-sm transition flex items-center gap-2"><i class="fas fa-plus"></i> Nuevo paquete</button>' : '';
        const nota = this.esKioscoFarmacia()
            ? 'La terminal permanece abierta. Cada movimiento queda a nombre de quien se identificó.'
            : 'Su sesión registra las entradas y salidas a su nombre.';
        const cuerpoHtml = `<div class="mb-4 flex flex-wrap items-end justify-between gap-3">
                    <div><h2 class="text-2xl font-extrabold text-slate-800">Farmacia e Inventario</h2>
                    <p class="text-slate-500">${nota}</p></div>
                    ${ingreso}${nuevoPaq}
                </div>
                <div class="inline-flex flex-wrap bg-slate-100 rounded-xl p-1 mb-5 gap-1">${visibles.map(t => tab(t[0], t[1])).join('')}</div>
                ${cuerpo}`;
        if (this.esKioscoFarmacia() && !this.operadorFarmacia()) {
            return `<div class="relative min-h-[70vh]">
                <div class="filter blur-md pointer-events-none select-none" aria-hidden="true">${cuerpoHtml}</div>
                <div class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 backdrop-blur-md p-6">
                    <form id="kiosco-farmacia" class="w-full max-w-md bg-white rounded-3xl shadow-2xl p-8" onsubmit="return false">
                        <p class="text-xs font-extrabold uppercase tracking-widest text-teal-700">Terminal de Farmacia</p>
                        <h3 class="text-2xl font-extrabold text-slate-900 mt-2 leading-tight">Identifíquese con su Código Personal para operar</h3>
                        <p class="text-sm text-slate-500 mt-2 mb-5">El almacén permanece bloqueado hasta que el personal ingrese su código o su contraseña.</p>
                        <label for="kiosco-codigo" class="sr-only">Código personal</label>
                        <input id="kiosco-codigo" type="password" inputmode="numeric" autocomplete="off" placeholder="Código rápido o contraseña" class="w-full border border-slate-300 rounded-xl p-3 text-lg tracking-widest mb-3">
                        <button type="button" onclick="AdminController.entrarKioscoFarmacia()" class="w-full bg-teal-700 hover:bg-teal-800 text-white font-bold py-3 rounded-xl">Entrar</button>
                    </form>
                </div>
            </div>`;
        }
        return cuerpoHtml;
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
        const tr = p => {
            const stock = S.textoStockFarmacia(p);
            return `<tr class="border-t border-slate-100 ${p.alerta ? 'bg-red-50 text-red-900' : 'hover:bg-slate-50/80'}" ${p.alerta ? `title="${e(motivo(p))}"` : ''}>
            <td class="px-3 py-3 font-mono text-xs font-bold">${e(p.sku)}</td>
            <td class="px-3 py-3 font-semibold">${e(p.nombre)}${p.nombre_comercial ? `<span class="block text-[11px] font-normal text-slate-500">${e(p.nombre_comercial)}</span>` : ''}</td>
            <td class="px-3 py-3 text-xs">${e(S.nombreFormaFarmaceutica(p.forma_farmaceutica))}${p.concentracion ? `<span class="block text-slate-500">${e(p.concentracion)}</span>` : ''}</td>
            <td class="px-3 py-3 text-xs">${e(p.laboratorio || '')}</td>
            <td class="px-3 py-3 font-mono text-xs">${e(p.lote)}</td>
            <td class="px-3 py-3">${e(S.fechaLegibleISO(p.caducidad))}${p.alerta && p.dias_caducidad !== null && p.dias_caducidad < 30 ? ' <i class="fas fa-triangle-exclamation text-red-600"></i>' : ''}</td>
            <td class="px-3 py-3"><span class="font-bold">${e(stock.piezas)}</span>${p.stock < 5 ? ' <i class="fas fa-triangle-exclamation text-red-600"></i>' : ''}<span class="block text-[11px] text-slate-500">${e(stock.cajas)}</span></td>
            <td class="px-3 py-3 font-bold">${this.rolActual === 'medico' ? '—' : e(S.formatoMoneda(p.precio_unitario))}${this.rolActual === 'medico' ? '' : p.aplica_iva ? '<span class="block text-[10px] font-normal text-amber-700">Grava 16% al facturar</span>' : '<span class="block text-[10px] font-normal text-slate-400">Tasa 0%</span>'}</td>
            <td class="px-3 py-3"><button type="button" onclick="AdminController.abrirIngresoFarmacia('${e(p.lote_id)}')" class="text-xs font-bold text-teal-800 hover:underline">Editar</button>${S.puedeDevolverFarmacia && S.puedeDevolverFarmacia(this.sesion) && p.stock > 0 ? `<button type="button" onclick="AdminController.abrirBajaFarmacia('${e(p.lote_id)}')" class="block mt-1 text-xs font-bold text-red-700 hover:underline whitespace-nowrap">Dar de baja por caducidad / merma</button>` : ''}</td></tr>`;
        };
        return `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-x-auto">
            <table class="w-full text-sm text-left" id="tabla-farmacia">
                <thead class="bg-slate-50 text-[11px] uppercase text-slate-400"><tr>
                    <th class="px-3 py-3">SKU</th><th class="px-3 py-3">Principio activo</th><th class="px-3 py-3">Forma</th><th class="px-3 py-3">Laboratorio</th>
                    <th class="px-3 py-3">Lote</th><th class="px-3 py-3">Caducidad</th><th class="px-3 py-3">Piezas disponibles</th><th class="px-3 py-3">Precio unitario</th><th class="px-3 py-3"></th>
                </tr></thead>
                <tbody>${filas.length ? filas.map(tr).join('') : '<tr><td colspan="9" class="px-4 py-16 text-center text-slate-400">No hay insumos en el almacén.</td></tr>'}</tbody>
            </table></div>
            <p class="text-[11px] text-slate-400 mt-3">La fila roja avisa stock menor a 5 o caducidad en menos de 30 días. El escáner completa el producto en cuanto el código coincide.</p>`;
    },

    htmlColaSurtido: function (pendientes) {
        const e = t => this.e(t);
        if (!pendientes.length) {
            return '<div class="text-center py-16 text-slate-400 font-medium bg-white/60 rounded-2xl border border-dashed border-slate-300"><i class="fas fa-clipboard-check text-4xl mb-3 text-slate-300"></i><p>No hay solicitudes pendientes de surtir.</p></div>';
        }
        const puede = BelenStore.puede('gestionar_farmacia');
        return `<div class="flex flex-col gap-3" id="cola-surtido">${pendientes.map(f => `<article class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-wrap items-center gap-4">
            <div class="flex-1 min-w-0 sm:min-w-[240px] w-full sm:w-auto">
                <p class="text-sm font-bold text-slate-900">Paciente: ${e(f.paciente)} - Cama: ${e(f.cama)} - Solicita: ${e(f.resumen)}</p>
                <p class="text-[11px] text-slate-400 mt-1 uppercase font-bold">${f.origen === 'consulta' ? 'Consulta ambulatoria' : 'Indicación de piso'}</p>
            </div>
            ${puede ? `<button type="button" onclick="AdminController.abrirSurtido('${e(f.solicitud_id)}')" class="bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold py-2.5 px-4 rounded-lg shadow-sm transition flex items-center gap-2"><i class="fas fa-barcode"></i> Surtir</button>` : ''}
        </article>`).join('')}</div>`;
    },

    abrirIngresoFarmacia: function (loteId) {
        const editando = loteId ? BelenStore.listarInventarioFarmacia(this.sesion).find(p => p.lote_id === loteId) : null;
        if (loteId && !editando) { BelenUI.toast('No se encontró el insumo.', 'alerta'); return; }
        if (!this.operadorFarmacia()) { BelenUI.toast('Identifíquese con su código personal para operar.', 'alerta'); return; }
        if (!BelenStore.puede('gestionar_farmacia')) { BelenUI.toast('Su perfil no puede registrar inventario.', 'alerta'); return; }
        const S = BelenStore;
        const campo = (id, et, tipo, extra) => `<div id="caja-${id}"><label for="${id}" class="block text-[11px] font-bold text-slate-500 uppercase mb-1">${et}</label>
            <input id="${id}" type="${tipo}" ${extra || ''} autocomplete="off" class="w-full border border-slate-300 rounded-lg p-2.5 text-sm text-slate-800 focus:border-teal-600 focus:ring-1 focus:ring-teal-600 outline-none bg-white">
            <p id="err-${id}" class="text-[11px] text-red-600 mt-1 hidden"></p></div>`;
        const sel = (id, et, opciones) => `<div><label for="${id}" class="block text-[11px] font-bold text-slate-500 uppercase mb-1">${et}</label>
            <select id="${id}" class="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white">${opciones}</select>
            <p id="err-${id}" class="text-[11px] text-red-600 mt-1 hidden"></p></div>`;
        const labs = `<datalist id="labs-farmacia">${S.LABORATORIOS_FRECUENTES.map(l => `<option value="${l}"></option>`).join('')}</datalist>`;
        BelenUI.modal({
            titulo: editando ? 'Editar insumo' : 'Nuevo ingreso de insumo', subtitulo: editando ? 'El stock no cambia. AWaRe se pide solo en Fracción IV Antibiótico.' : 'Medicamento o material de curación. Los estudios viven en su propio catálogo.', icono: 'fa-barcode', ancho: 'xl',
            html: `${labs}<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                ${sel('far-categoria', 'Categoría', S.CATEGORIAS_ALMACEN.map(c => `<option value="${c.codigo}">${c.nombre}</option>`).join(''))}
                ${campo('far-sku', 'Código de barras / SKU', 'text', 'data-autofoco maxlength="20" placeholder="Escanee el código. En material es opcional."')}
                ${campo('far-nombre', 'Principio activo / denominación genérica', 'text', 'maxlength="80" placeholder="Ej. Dapagliflozina"')}
                ${campo('far-comercial', 'Nombre comercial / distintivo', 'text', 'maxlength="80" placeholder="Opcional. Ej. Daposar"')}
                ${sel('far-forma', 'Forma farmacéutica', S.FORMAS_FARMACEUTICAS.filter(f => f.codigo !== 'ESTUDIO').map(f => `<option value="${f.codigo}">${f.nombre}</option>`).join(''))}
                ${campo('far-concentracion', 'Concentración', 'text', 'maxlength="40" placeholder="Ej. 10 mg, 1 g / 10 ml"')}
                ${sel('far-via', 'Vía de administración', S.VIAS_ADMINISTRACION.map(v => `<option value="${v.codigo}" ${v.codigo === 'NA' ? 'selected' : ''}>${v.nombre}</option>`).join(''))}
                ${sel('far-conservacion', 'Conservación', S.CONSERVACIONES.map(c => `<option value="${c.codigo}">${c.nombre}</option>`).join(''))}
                ${campo('far-laboratorio', 'Laboratorio (fabricante)', 'text', 'maxlength="40" list="labs-farmacia" placeholder="Pisa, Pfizer, Bayer…"')}
                ${campo('far-proveedor', 'Proveedor (distribuidor)', 'text', 'maxlength="60"')}
                ${campo('far-factura', 'Folio de factura de compra', 'text', 'maxlength="30"')}
                ${sel('far-fraccion', 'Fracción COFEPRIS', S.FRACCIONES_COFEPRIS.map(f => `<option value="${f.codigo}" ${f.codigo === 'NA' ? 'selected' : ''}>${f.nombre}</option>`).join(''))}
                <div id="caja-far-aware"><label for="far-aware" class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Clasificación AWaRe (Antibióticos FEUM/OMS)</label>
                <select id="far-aware" class="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white"><option value="">No aplica (Solo para Fracción IV Antibiótico)</option></select>
                <p id="err-far-aware" class="text-[11px] text-red-600 mt-1 hidden"></p></div>
                ${sel('far-modo', 'Modo de captura de stock', '<option value="cajas">Por cajas</option><option value="piezas">Por piezas sueltas / unidades</option>')}
                ${campo('far-piezas', 'Piezas por caja', 'number', 'min="1" step="1" value="1"')}
                ${campo('far-cajas', 'Número de cajas que ingresan', 'number', 'min="1" step="1"')}
                ${campo('far-stock', 'Piezas individuales', 'number', 'min="1" step="1"')}
                ${campo('far-lote', 'Lote', 'text', 'maxlength="30"')}
                ${campo('far-caducidad', 'Caducidad', 'date', '')}
                ${campo('far-precio', 'Precio unitario (sin IVA)', 'number', 'min="0.01" step="0.01"')}
            </div>
            <p id="far-total" class="mt-3 text-sm font-bold text-teal-800">Total que se sumará al inventario: 0 piezas (unidades individuales).</p>
            <label class="mt-3 flex items-center gap-2 text-sm text-slate-700"><input id="far-iva" type="checkbox" class="rounded border-slate-300 text-teal-700"> Grava 16% de IVA en caso de facturación</label>
            <p id="far-precio-iva" class="text-xs text-slate-500 mt-1"></p>`,
            alMostrar: c => {
                const q = id => c.el.querySelector('#' + id);
                const pintarPrecio = () => {
                    const precio = parseFloat(q('far-precio').value);
                    const aplica = q('far-iva').checked;
                    q('far-precio-iva').textContent = Number.isFinite(precio) ? (aplica ? 'Si solicitan factura: ' + S.formatoMoneda(Math.round(precio * 116) / 100) : 'Tasa 0%. En Caja se cobra este precio.') : '';
                };
                const etiqueta = (id, texto) => { const lab = c.el.querySelector('label[for="' + id + '"]'); if (lab) lab.textContent = texto; };
                const pintarAware = () => {
                    const material = q('far-categoria').value === 'MATERIAL_CURACION';
                    const antibiotico = !material && q('far-fraccion').value === 'IV_ANTIBIOTICO';
                    const cajaAware = c.el.querySelector('#caja-far-aware');
                    if (cajaAware) cajaAware.classList.toggle('hidden', material);
                    const selAware = q('far-aware');
                    if (!selAware) return;
                    if (antibiotico) {
                        if (selAware.dataset.modo !== 'on') {
                            const actual = selAware.value;
                            selAware.innerHTML = '<option value="">Seleccione…</option>' + S.CLASIFICACION_AWARE.map(a => '<option value="' + a.codigo + '">' + a.nombre + '</option>').join('');
                            if (['ACCESO', 'VIGILANCIA', 'RESERVA'].indexOf(actual) >= 0) selAware.value = actual;
                            selAware.dataset.modo = 'on';
                        }
                        selAware.disabled = false;
                    } else {
                        selAware.dataset.modo = 'off';
                        selAware.innerHTML = '<option value="">No aplica (Solo para Fracción IV Antibiótico)</option>';
                        selAware.value = '';
                        selAware.disabled = true;
                    }
                };
                const pintarModo = () => {
                    const material = q('far-categoria').value === 'MATERIAL_CURACION';
                    ['far-comercial', 'far-forma', 'far-concentracion', 'far-via', 'far-conservacion', 'far-proveedor', 'far-fraccion'].forEach(id => {
                        const cajaCampo = c.el.querySelector('#caja-' + id) || (q(id) && q(id).closest('div'));
                        if (cajaCampo) cajaCampo.classList.toggle('hidden', material);
                    });
                    pintarAware();
                    etiqueta('far-nombre', material ? 'Nombre del insumo' : 'Principio activo / denominación genérica');
                    etiqueta('far-laboratorio', material ? 'Marca / Laboratorio' : 'Laboratorio (fabricante)');
                    etiqueta('far-sku', material ? 'Código de barras (opcional)' : 'Código de barras / SKU');
                };
                const pintarStock = () => {
                    const modo = q('far-modo').value;
                    q('caja-far-cajas').classList.toggle('hidden', modo !== 'cajas');
                    q('caja-far-stock').classList.toggle('hidden', modo === 'cajas');
                    const piezas = parseInt(q('far-piezas').value, 10) || 0;
                    const cajas = parseInt(q('far-cajas').value, 10) || 0;
                    const sueltas = parseInt(q('far-stock').value, 10) || 0;
                    const total = modo === 'cajas' ? piezas * cajas : sueltas;
                    q('far-total').textContent = 'Total que se sumará al inventario: ' + (total > 0 ? total : 0) + ' piezas (unidades individuales).';
                };
                const llenar = prod => {
                    q('far-nombre').value = prod.nombre;
                    q('far-comercial').value = prod.nombre_comercial || '';
                    q('far-forma').value = prod.forma_farmaceutica || 'TABLETA';
                    q('far-concentracion').value = prod.concentracion || '';
                    q('far-via').value = prod.via_administracion || 'NA';
                    q('far-conservacion').value = prod.conservacion || 'AMBIENTE';
                    q('far-laboratorio').value = prod.laboratorio || '';
                    q('far-proveedor').value = prod.proveedor || '';
                    q('far-categoria').value = prod.categoria || 'MEDICAMENTO';
                    q('far-fraccion').value = prod.fraccion_cofepris || 'NA';
                    pintarModo();
                    if (prod.clasificacion_aware && q('far-aware') && !q('far-aware').disabled) q('far-aware').value = prod.clasificacion_aware;
                    q('far-piezas').value = prod.piezas_por_caja || 1;
                    q('far-iva').checked = !!prod.aplica_iva;
                    q('far-precio').value = prod.precio_unitario;
                    pintarPrecio();
                    pintarStock();
                    q('far-lote').focus();
                };
                let esperaSku = null;
                q('far-sku').addEventListener('input', () => {
                    clearTimeout(esperaSku);
                    const codigo = q('far-sku').value.trim();
                    esperaSku = setTimeout(() => {
                        const prod = S.productoPorSku(codigo);
                        if (prod) llenar(prod);
                    }, 140);
                });
                ['far-modo', 'far-piezas', 'far-cajas', 'far-stock'].forEach(id => q(id).addEventListener('input', pintarStock));
                q('far-modo').addEventListener('change', pintarStock);
                q('far-precio').addEventListener('input', pintarPrecio);
                q('far-iva').addEventListener('change', pintarPrecio);
                q('far-categoria').addEventListener('change', pintarModo);
                q('far-fraccion').addEventListener('change', pintarModo);
                pintarModo();
                pintarStock();
                if (editando) {
                    ['caja-far-modo', 'caja-far-cajas', 'caja-far-stock'].forEach(id => { const n = c.el.querySelector('#' + id); if (n) n.classList.add('hidden'); });
                    if (q('far-total')) q('far-total').classList.add('hidden');
                    q('far-sku').readOnly = true;
                    llenar(editando);
                    q('far-lote').value = editando.lote || '';
                    q('far-caducidad').value = editando.caducidad || '';
                    q('far-factura').value = editando.numero_factura || '';
                }
                q('far-lote').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); q('far-caducidad').focus(); } });
            },
            botones: [
                { texto: 'Cancelar', estilo: 'secundario' },
                { texto: editando ? 'Guardar cambios' : 'Registrar ingreso', estilo: 'exito', id: 'far-guardar', alPulsar: c => {
                    const val = id => c.el.querySelector('#' + id).value;
                    const material = val('far-categoria') === 'MATERIAL_CURACION';
                    const ficha = {
                        sku: val('far-sku'), nombre: val('far-nombre'), nombre_comercial: material ? '' : val('far-comercial'),
                        forma_farmaceutica: material ? 'MATERIAL' : val('far-forma'), concentracion: material ? '' : val('far-concentracion'),
                        via_administracion: material ? 'NA' : val('far-via'), conservacion: material ? 'AMBIENTE' : val('far-conservacion'),
                        laboratorio: val('far-laboratorio'), proveedor: material ? '' : val('far-proveedor'), numero_factura: val('far-factura'),
                        categoria: val('far-categoria'), fraccion_cofepris: material ? 'NA' : val('far-fraccion'),
                        clasificacion_aware: (!material && val('far-fraccion') === 'IV_ANTIBIOTICO') ? val('far-aware') : '',
                        modo_stock: val('far-modo'),
                        piezas_por_caja: val('far-piezas'), numero_cajas: val('far-cajas'), lote: val('far-lote'), caducidad: val('far-caducidad'),
                        stock: val('far-stock'), precio_unitario: val('far-precio'), aplica_iva: c.el.querySelector('#far-iva').checked, operador_id: (this.operadorFarmacia() || {}).id
                    };
                    const r = editando ? S.actualizarInsumo(editando.lote_id, ficha, this.sesion) : S.ingresarInsumo(ficha, this.sesion);
                    const mapa = { 'far-sku': 'sku', 'far-nombre': 'nombre', 'far-comercial': 'nombre_comercial', 'far-forma': 'forma_farmaceutica', 'far-concentracion': 'concentracion', 'far-via': 'via_administracion', 'far-conservacion': 'conservacion', 'far-laboratorio': 'laboratorio', 'far-proveedor': 'proveedor', 'far-factura': 'numero_factura', 'far-categoria': 'categoria', 'far-fraccion': 'fraccion_cofepris', 'far-aware': 'clasificacion_aware', 'far-piezas': 'piezas_por_caja', 'far-cajas': 'numero_cajas', 'far-stock': 'stock', 'far-lote': 'lote', 'far-caducidad': 'caducidad', 'far-precio': 'precio_unitario' };
                    Object.keys(mapa).forEach(id => {
                        const input = c.el.querySelector('#' + id), msg = c.el.querySelector('#err-' + id);
                        const error = r.errores && r.errores[mapa[id]];
                        if (input) input.classList.toggle('border-red-500', !!error);
                        if (msg) { msg.textContent = error || ''; msg.classList.toggle('hidden', !error); }
                    });
                    if (!r.ok) { if (!r.errores) BelenUI.toast(r.motivo, 'alerta'); return false; }
                    const eq = S.textoStockFarmacia(r.producto);
                    BelenUI.toast(editando ? (r.producto.nombre + ' actualizado.') : (r.producto.nombre + ' ingresado. ' + eq.piezas + ' (' + eq.cajas + ').'), 'exito');
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
        if (r.fefo) { this.avisarFefo(r, lote => this.confirmarEscaneo(ctrl, solicitudId, { codigo: lote.lote, lote_id: lote.lote_id, ignorar_fefo: true })); return; }
        if (!r.ok) {
            BelenUI.toast(r.motivo, 'alerta');
            const lista = ctrl.el.querySelector('#scan-lista');
            if (lista) lista.value = '';
            if (input) { input.focus(); input.select(); }
            return;
        }
        BelenUI.toast(r.completa ? 'Solicitud surtida. El costo ya está en la cuenta.' : r.producto.nombre + ' surtido. Quedan ' + r.producto.stock + ' en almacén.', r.completa ? 'exito' : 'info');
        this.pestanaFarmacia = 'terminal';
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
        let usado = false;
        const elegir = quedarse => {
            if (usado) return false;
            usado = true;
            alElegir(quedarse ? r.lote : r.alterno);
        };
        BelenUI.modal({
            titulo: 'Aviso FEFO', mensaje: texto, tipo: 'alerta', icono: 'fa-clock', ancho: 'md',
            botones: [
                { texto: 'Continuar con el lote actual de todos modos', estilo: 'secundario', alPulsar: () => elegir(true) },
                { texto: 'Cambiar al Lote más próximo (Recomendado)', estilo: 'primario', alPulsar: () => elegir(false) }
            ]
        });
    },

    pacienteCargoActual: function () {
        const grupos = BelenStore.pacientesTerminalFarmacia(this.sesion);
        return ['hospital', 'observacion', 'quirofano', 'consulta'].reduce((hallado, k) => hallado || grupos[k].find(p => p.turno_id === this.pacienteCargoId) || null, null);
    },

    htmlTerminalFarmacia: function () {
        if (!this.operadorFarmacia()) {
            return '<div class="rounded-2xl border border-dashed border-amber-300 bg-white p-10 text-center text-amber-800 font-semibold">Identifíquese arriba para cargar a un paciente o retirar del almacén.</div>';
        }
        const S = BelenStore, e = t => this.e(t);
        const grupos = S.pacientesTerminalFarmacia(this.sesion);
        const etiquetas = [['consulta', 'En Consulta Actual'], ['observacion', 'En Observación'], ['hospital', 'Hospitalizados'], ['quirofano', 'En Quirófano / Recuperación']];
        const elegido = this.modoRetiroAdmin ? null : this.pacienteCargoActual();
        const bloques = etiquetas.map(([k, titulo]) => {
            const lista = grupos[k];
            const botones = lista.length ? lista.map(p => `<button type="button" onclick="AdminController.elegirPacienteCargo('${e(p.turno_id)}')" class="w-full text-left px-3 py-2 rounded-lg border ${!this.modoRetiroAdmin && p.turno_id === this.pacienteCargoId ? 'border-teal-600 bg-teal-50' : 'border-slate-200 bg-white hover:bg-slate-50'}">
                <span class="block text-sm font-bold text-slate-800">${e(p.nombre)}</span>
                <span class="block text-[11px] text-slate-500">${e(p.cama)}${p.medico ? ' · ' + e(p.medico) : ''}</span></button>`).join('') : '<p class="text-xs text-slate-400 px-1">Nadie en esta área.</p>';
            return `<section class="mb-4"><h3 class="text-[11px] font-extrabold uppercase tracking-wide text-slate-400 mb-2">${titulo}</h3><div class="flex flex-col gap-2">${botones}</div></section>`;
        }).join('');
        const op = this.operadorFarmacia();
        const retiro = op && op.rol === 'admin'
            ? `<button type="button" onclick="AdminController.activarRetiroAdmin()" class="w-full mb-2 text-left bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 px-3 rounded-xl ${this.modoRetiroAdmin ? 'ring-4 ring-amber-300' : ''}">Retiro Directo de Administración (Sin Paciente)</button>`
            : '';
        const externoBtn = `<button type="button" onclick="AdminController.activarRecetaExterna()" class="w-full mb-4 text-left bg-amber-700 hover:bg-amber-800 text-white font-bold py-3 px-3 rounded-xl ${this.modoExterno ? 'ring-4 ring-amber-300' : ''}">🏥 Surtir Receta Externa (Paciente Externo / Mostrador)</button>`;
        let banner;
        if (this.modoRetiroAdmin) {
            const recientes = S.listarSalidasFarmacia().slice(-5).reverse().map(s => `<li class="py-1">${e(S.fechaHoraLegible(s.fecha_hora))} · ${e(s.operador_nombre)} · ${s.cantidad}× ${e(s.nombre)} · lote ${e(s.lote)}</li>`).join('');
            banner = `<div class="rounded-2xl border-4 border-slate-800 bg-slate-50 px-5 py-5 mb-4">
                <p class="text-xs font-extrabold uppercase tracking-wide text-slate-500">Retiro sin paciente</p>
                <p class="text-2xl font-extrabold text-slate-900">Retiro directo de administración</p>
                <p class="text-sm text-slate-600 mt-1">Queda en la bitácora a nombre de ${e(op.nombre)}, con fecha y hora. No se carga a ninguna cuenta.</p>
                <button type="button" onclick="AdminController.quitarPacienteCargo()" class="mt-3 bg-white border-2 border-red-500 text-red-700 font-extrabold px-4 py-2 rounded-xl">✕ Quitar / Cambiar Paciente</button>
                ${recientes ? `<ul class="mt-4 text-xs text-slate-600 border-t border-slate-200 pt-2">${recientes}</ul>` : ''}
            </div>`;
        } else if (elegido) {
            const edadTxt = elegido.edad === null || elegido.edad === undefined ? 'Edad no registrada' : elegido.edad + (elegido.edad === 1 ? ' año' : ' años');
            banner = `<div class="rounded-2xl border-4 border-teal-600 bg-teal-50 px-5 py-5 mb-4">
                <div class="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <p class="text-xs font-extrabold uppercase tracking-wide text-teal-700">Paciente seleccionado</p>
                        <p class="text-3xl font-extrabold text-teal-950 leading-tight">${e(elegido.nombre)}</p>
                        <p class="text-lg text-teal-900 mt-1">${e(edadTxt)} · ${e(elegido.area_txt)} · ${e(elegido.cama)}</p>
                        <p class="text-sm font-bold text-teal-800 mt-1">Médico: ${e(elegido.medico || 'Sin médico')}</p>
                        ${this.htmlRespaldoKiosco(elegido)}
                    </div>
                    <button type="button" onclick="AdminController.quitarPacienteCargo()" class="bg-white border-2 border-red-500 text-red-700 font-extrabold px-4 py-3 rounded-xl">✕ Quitar / Cambiar Paciente</button>
                </div>
            </div>`;
        } else {
            banner = '<div class="rounded-2xl border border-dashed border-slate-300 px-4 py-6 mb-4 text-sm text-slate-500">Seleccione al paciente antes de escanear.</div>';
        }
        if (this.modoExterno) {
            banner = `<div class="rounded-2xl border-4 border-amber-600 bg-amber-50 px-5 py-5 mb-4">
                <p class="text-xs font-extrabold uppercase tracking-wide text-amber-800">Mostrador</p>
                <p class="text-2xl font-extrabold text-amber-950">Receta externa</p>
                <p class="text-sm text-amber-900 mt-1">Si el carrito lleva antibiótico o controlado, al confirmar se piden los datos del paciente, del médico y el folio. Si la receta física no trae folio, el sistema asigna EXT-00001 y pide anotarlo en el papel.</p>
                <button type="button" onclick="AdminController.quitarPacienteCargo()" class="mt-3 bg-white border-2 border-red-500 text-red-700 font-extrabold px-4 py-2 rounded-xl">✕ Salir de receta externa</button>
            </div>`;
        }
        return `<div class="grid grid-cols-1 lg:grid-cols-5 gap-5">
            <aside class="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm p-4 max-h-[70vh] overflow-y-auto">${retiro}${externoBtn}${bloques}</aside>
            <section class="lg:col-span-3 bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
                ${banner}
                ${this.htmlMiniPaquetesTerminal()}
                <label for="busca-folio-receta" class="block text-[11px] font-bold text-slate-500 uppercase mb-1">🔍 Buscar / Surtir por Folio de Receta</label>
                <div class="flex gap-2 mb-2">
                    <input id="busca-folio-receta" value="${e(this.folioBuscadoTexto || '')}" autocomplete="off" placeholder="SB-REC-00001" class="flex-1 border border-amber-400 rounded-lg p-2.5 text-sm font-mono uppercase" onkeydown="if(event.key==='Enter'){event.preventDefault();AdminController.buscarFolioReceta();}">
                    <button type="button" onclick="AdminController.buscarFolioReceta()" class="bg-amber-700 hover:bg-amber-800 text-white text-xs font-extrabold px-3 rounded-lg">Buscar</button>
                </div>
                ${this.htmlResultadoFolioReceta()}
                <label for="terminal-scan" class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Pistola lectora</label>
                <input id="terminal-scan" data-terminal-scan autocomplete="off" placeholder="Escanee el código. Entra solo al coincidir." class="w-full border border-teal-400 rounded-lg p-3 text-sm font-mono focus:ring-2 focus:ring-teal-500 outline-none mb-3">
                <label for="terminal-buscar" class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Buscar por principio activo, nombre comercial o SKU</label>
                <input id="terminal-buscar" autocomplete="off" placeholder="Principio activo, nombre comercial o lote" oninput="AdminController.pintarBusquedaFarmacia(this.value)" class="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none mb-2">
                <div id="terminal-busqueda" class="flex flex-col gap-1 mb-3"></div>
                <div class="flex flex-wrap gap-2 mb-4">
                    <button type="button" onclick="AdminController.abrirAplicarPaquete()" class="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-3 py-2 rounded-lg"><i class="fas fa-kit-medical mr-1"></i> Aplicar Paquete Completo</button>
                </div>
                ${this.htmlCarritoFarmacia()}
            </section>
        </div>`;
    },

    enlazarTerminalFarmacia: function () {
        const kiosco = document.getElementById('kiosco-codigo');
        if (kiosco) {
            let esperaPin = null;
            kiosco.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); this.entrarKioscoFarmacia(); } });
            kiosco.addEventListener('input', () => {
                clearTimeout(esperaPin);
                const valor = kiosco.value.trim();
                esperaPin = setTimeout(() => { if (valor && BelenStore.identificarOperadorFarmacia(valor).ok) this.entrarKioscoFarmacia(); }, 140);
            });
            kiosco.focus();
            return;
        }
        const scan = document.getElementById('terminal-scan');
        if (!scan) return;
        let espera = null;
        scan.addEventListener('input', () => {
            clearTimeout(espera);
            const valor = scan.value.trim();
            espera = setTimeout(() => {
                if (!valor || !BelenStore.productoPorSku(valor)) return;
                scan.value = '';
                this.recibirEnCarrito(valor);
            }, 140);
        });
        scan.addEventListener('keydown', ev => {
            if (ev.key !== 'Enter') return;
            ev.preventDefault();
            clearTimeout(espera);
            const codigo = scan.value.trim();
            scan.value = '';
            if (codigo) this.recibirEnCarrito(codigo);
        });
        scan.focus();
    },

    elegirPacienteCargo: function (turnoId) {
        this.modoRetiroAdmin = false;
        this.modoExterno = false;
        this.pacienteCargoId = turnoId;
        this.render();
    },

    quitarPacienteCargo: function () {
        this.pacienteCargoId = null;
        this.modoRetiroAdmin = false;
        this.modoExterno = false;
        this.render();
    },

    activarRecetaExterna: function () {
        this.modoExterno = true;
        this.modoRetiroAdmin = false;
        this.pacienteCargoId = null;
        this.render();
    },

    buscarFolioReceta: function () {
        const input = document.getElementById('busca-folio-receta');
        const texto = input ? input.value.trim() : this.folioBuscadoTexto;
        this.folioBuscadoTexto = texto;
        const receta = BelenStore.recetaPorFolio(texto);
        if (!receta) { BelenUI.toast('No hay una receta con ese folio.', 'alerta'); this.folioBuscadoId = null; this.render(); return; }
        this.folioBuscadoId = receta.receta_id;
        this.render();
    },

    activarRetiroAdmin: function () {
        if (!this.operadorFarmacia() || this.operadorFarmacia().rol !== 'admin') return;
        this.modoRetiroAdmin = true;
        this.pacienteCargoId = null;
        this.render();
    },

    pintarBusquedaFarmacia: function (texto) {
        const caja = document.getElementById('terminal-busqueda');
        if (!caja) return;
        const e = t => this.e(t);
        const lotes = BelenStore.buscarLotesFarmacia(texto);
        caja.innerHTML = lotes.map(p => `<button type="button" onclick="AdminController.agregarLoteAlCarrito('${e(p.lote_id)}')" class="text-left px-3 py-2 rounded-lg border border-slate-200 hover:bg-teal-50 text-xs">
            <span class="font-bold">${e(BelenStore.denominacionProducto(p))}</span> · ${e(p.sku)} · Lote ${e(p.lote)} · caduca ${e(BelenStore.fechaLegibleISO(p.caducidad))} · ${e(BelenStore.textoStockFarmacia(p).piezas)}</button>`).join('');
    },

    htmlCarritoFarmacia: function () {
        const S = BelenStore, e = t => this.e(t);
        const inv = S.listarInventarioFarmacia(this.sesion);
        const op = this.operadorFarmacia();
        const puedeReceta = !!(op && S.puedeEmitirRecetaMedica(op.rol));
        let base = 0;
        const filas = this.carritoFarmacia.map(lin => {
            const est = lin.estudio_id ? (S.estudioPorCodigo(lin.sku) || null) : null;
            const p = est ? null : inv.find(x => x.lote_id === lin.lote_id);
            if (!p && !est) return `<tr><td colspan="4" class="px-3 py-2 text-red-600">Un lote del carrito ya no está disponible.</td></tr>`;
            const cant = lin.cantidad || 1;
            const precio = est ? est.precio_unitario : p.precio_unitario;
            const sub = Math.round(precio * cant * 100) / 100;
            base += sub;
            const fraccion = p ? p.fraccion_cofepris : '';
            const aviso = S.badgeRecetaMedica(fraccion);
            const receta = puedeReceta && ['II', 'III', 'IV_ANTIBIOTICO'].indexOf(fraccion) >= 0
                ? `<button type="button" onclick="AdminController.imprimirRecetaLinea('${e(lin.linea_id)}')" class="mt-1 text-[11px] font-bold text-rose-700 underline">Generar e Imprimir Receta</button>` : '';
            const frac = fraccion === 'I' && lin.receta_previa ? `<p class="text-[11px] text-amber-800">Receta individual ${e(lin.receta_previa)} · caja ${e(lin.folio_receta_especial || '')}</p>` : '';
            const respaldo = lin.folio_receta ? `<p class="text-[11px] text-slate-600 mt-1">${e(lin.tipo_respaldo || 'Folio')} · <b>${e(lin.folio_receta)}</b>${lin.medico_prescriptor_nombre ? ' · ' + e(lin.medico_prescriptor_nombre) : ''}${lin.cedula_prescriptor ? ' · ' + e(lin.cedula_prescriptor) : ''}</p><button type="button" onclick="AdminController.cambiarFolioLinea('${e(lin.linea_id)}')" class="text-[11px] font-bold text-slate-500 underline">Folio en papel</button>` : '';
            const gravable = (est ? est.aplica_iva : p.aplica_iva) ? '<p class="text-[11px] font-bold text-amber-700">Grava 16% si solicitan factura</p>' : '';
            const bloqueada = fraccion === 'I';
            const control = `<div class="inline-flex items-center justify-center gap-1">
                <button type="button" ${bloqueada ? 'disabled' : ''} onclick="AdminController.cambiarCantidadCarrito('${e(lin.linea_id)}', -1)" class="w-8 h-8 rounded-lg border border-slate-300 text-slate-700 font-bold disabled:opacity-40" aria-label="Disminuir">−</button>
                <input data-cant-linea="${e(lin.linea_id)}" type="number" min="1" max="99" value="${cant}" ${bloqueada ? 'readonly' : ''} onchange="AdminController.fijarCantidadCarrito('${e(lin.linea_id)}', this.value)" class="w-14 h-8 text-center border border-slate-300 rounded-lg text-sm font-bold">
                <button type="button" ${bloqueada ? 'disabled' : ''} onclick="AdminController.cambiarCantidadCarrito('${e(lin.linea_id)}', 1)" class="w-8 h-8 rounded-lg border border-slate-300 text-slate-700 font-bold disabled:opacity-40" aria-label="Aumentar">+</button>
            </div>`;
            const titulo = est ? est.nombre : S.denominacionProducto(p);
            const detalle = est ? 'Estudio · ' + S.nombreTipoEstudio(est.tipo) : 'Lote ' + p.lote;
            const lotesLinea = (!est && lin.confirmar_lote) ? S.lotesVigentesDeSku(p.sku) : [];
            const selectorLote = lotesLinea.length ? `<label class="block text-[10px] font-bold uppercase text-slate-500 mt-2">Lote y caducidad</label><select onchange="AdminController.cambiarLoteLinea('${e(lin.linea_id)}', this.value)" class="mt-1 w-full max-w-sm border border-teal-300 rounded-lg p-1.5 text-xs bg-white">${lotesLinea.map(l => `<option value="${e(l.lote_id)}" ${l.lote_id === p.lote_id ? 'selected' : ''}>Lote ${e(l.lote)} · Caduca ${e(S.fechaLegibleISO(l.caducidad))} · ${l.stock} pzas${l.lote_id === lotesLinea[0].lote_id ? ' · FEFO' : ''}</option>`).join('')}</select>` : '';
            return `<tr class="border-t border-slate-100 align-top">
                <td class="px-3 py-2"><p class="font-semibold text-slate-800">${e(titulo)}</p><p class="text-[11px] text-slate-400">${e(detalle)}${lin.paquete_nombre ? ' · ' + e(lin.paquete_nombre) : ''}</p>${selectorLote}
                    ${gravable}${aviso ? `<p class="text-[11px] font-bold text-rose-700 mt-1">${e(aviso)}</p>${receta}` : ''}${frac}${respaldo}</td>
                <td class="px-3 py-2 text-center">${control}</td>
                <td class="px-3 py-2 text-right">${e(S.formatoMoneda(sub))}</td>
                <td class="px-3 py-2 text-right"><button type="button" onclick="AdminController.quitarLineaCarrito('${e(lin.linea_id)}')" class="text-slate-400 hover:text-red-600" aria-label="Quitar"><i class="fas fa-xmark"></i></button></td>
            </tr>`;
        }).join('');
        const ajustes = this.ajustesVisiblesCarrito();
        const filasAjuste = ajustes.map(a => {
            base += a.subtotal;
            return `<tr class="border-t border-emerald-100 bg-emerald-50/60"><td class="px-3 py-2 font-semibold text-emerald-900">${e(a.concepto)}</td><td class="px-3 py-2 text-center">1</td><td class="px-3 py-2 text-right font-bold text-emerald-800">${e(S.formatoMoneda(a.subtotal))}</td><td></td></tr>`;
        }).join('');
        const vacio = this.carritoFarmacia.length ? '' : '<tr><td colspan="4" class="px-3 py-8 text-center text-slate-400">El carrito está vacío.</td></tr>';
        const totalBase = Math.round(base * 100) / 100;
        return `<div id="carrito-farmacia"><div class="overflow-x-auto -mx-1 px-1"><table class="w-full text-sm min-w-[300px]"><thead class="text-[11px] uppercase text-slate-400"><tr><th class="px-3 py-2 text-left">Concepto</th><th class="px-3 py-2">Cant.</th><th class="px-3 py-2 text-right">Importe</th><th></th></tr></thead>
            <tbody>${filas || vacio}${filasAjuste}</tbody></table></div>
            <div class="mt-3 border-t border-slate-100 pt-3 text-sm space-y-1">
                <p class="flex justify-between font-extrabold text-slate-900 text-base"><span>Total sin IVA</span><span>${e(S.formatoMoneda(totalBase))}</span></p>
                <p class="text-[11px] text-slate-500">El IVA de los conceptos gravables se calcula en Caja, solo si el paciente solicita factura.</p>
            </div>
            <button type="button" onclick="AdminController.confirmarCargoPaciente()" class="mt-4 w-full bg-teal-700 hover:bg-teal-800 text-white font-bold py-3 rounded-xl">${this.modoRetiroAdmin ? 'Registrar salida de almacén' : 'Confirmar y Cargar a Cuenta'}</button></div>`;
    },

    ajustesVisiblesCarrito: function () {
        const S = BelenStore;
        const inv = S.listarInventarioFarmacia(this.sesion);
        const grupos = {};
        this.carritoFarmacia.forEach(lin => {
            if (!lin.paquete_id) return;
            const est = lin.estudio_id ? S.estudioPorCodigo(lin.sku) : null;
            const p = est ? null : inv.find(x => x.lote_id === lin.lote_id);
            const precio = est ? est.precio_unitario : (p ? p.precio_unitario : 0);
            if (!grupos[lin.paquete_id]) grupos[lin.paquete_id] = { nombre: lin.paquete_nombre || '', subtotal: 0 };
            grupos[lin.paquete_id].subtotal += precio * (lin.cantidad || 1);
        });
        return Object.keys(grupos).map(id => {
            const paq = S.listarPaquetes().find(p => p.paquete_id === id);
            if (!paq || paq.precio_paquete == null || paq.precio_paquete === '') return null;
            const suma = Math.round(grupos[id].subtotal * 100) / 100;
            const pactado = Math.round(Number(paq.precio_paquete) * 100) / 100;
            if (!(pactado < suma)) return null;
            const diff = Math.round((pactado - suma) * 100) / 100;
            return { concepto: 'Descuento por Paquete ' + grupos[id].nombre + ' (' + S.formatoMoneda(diff) + ')', subtotal: diff };
        }).filter(Boolean);
    },

    repintarCarritoFarmacia: function () {
        const caja = document.getElementById('carrito-farmacia');
        if (!caja) { this.render(); return; }
        const activo = document.activeElement;
        const id = activo && activo.getAttribute && activo.getAttribute('data-cant-linea');
        caja.outerHTML = this.htmlCarritoFarmacia();
        if (id) {
            const inp = document.querySelector('[data-cant-linea="' + id + '"]');
            if (inp) inp.focus();
        }
    },

    fijarCantidadCarrito: function (lineaId, valor) {
        const lin = this.carritoFarmacia.find(l => l.linea_id === lineaId);
        if (!lin) return;
        let n = parseInt(valor, 10);
        if (!Number.isInteger(n) || n < 1) n = 1;
        if (n > 99) n = 99;
        if (lin.lote_id && !lin.servicio) {
            const p = BelenStore.listarInventarioFarmacia(this.sesion).find(x => x.lote_id === lin.lote_id);
            if (p && p.fraccion_cofepris === 'I') n = 1;
            const otros = this.carritoFarmacia.filter(l => l !== lin && l.lote_id === lin.lote_id).reduce((s, l) => s + (l.cantidad || 1), 0);
            const tope = p ? p.stock - otros : n;
            if (p && n > tope) {
                BelenUI.toast('Solo hay ' + Math.max(0, tope) + ' piezas disponibles de ' + p.nombre + '.', 'alerta');
                n = Math.max(1, Math.min(99, tope));
            }
            const falta = p && lin.folio_receta ? BelenStore.pendienteFolioSku(lin.folio_receta, p.sku) : null;
            if (falta !== null && n > falta) {
                BelenUI.toast('De ' + lin.folio_receta + ' solo faltan ' + falta + ' piezas.', 'alerta');
                n = falta;
            }
        }
        if (n < 1) {
            this.carritoFarmacia = this.carritoFarmacia.filter(l => l !== lin);
            this.repintarCarritoFarmacia();
            return;
        }
        lin.cantidad = n;
        this.repintarCarritoFarmacia();
    },

    cambiarCantidadCarrito: function (lineaId, delta) {
        const lin = this.carritoFarmacia.find(l => l.linea_id === lineaId);
        if (!lin) return;
        this.fijarCantidadCarrito(lineaId, (lin.cantidad || 1) + delta);
    },

    quitarLineaCarrito: function (lineaId) {
        this.carritoFarmacia = this.carritoFarmacia.filter(l => l.linea_id !== lineaId);
        this.render();
    },

    cambiarLoteLinea: function (lineaId, loteId) {
        const lin = this.carritoFarmacia.find(l => l.linea_id === lineaId);
        if (!lin || lin.lote_id === loteId) return;
        const S = BelenStore;
        const actual = S.listarInventarioFarmacia(this.sesion).find(x => x.lote_id === lin.lote_id);
        const sku = (actual && actual.sku) || lin.sku;
        const lotes = S.lotesVigentesDeSku(sku);
        const nuevo = lotes.find(x => x.lote_id === loteId);
        if (!nuevo) { BelenUI.toast('Ese lote ya no tiene stock vigente.', 'alerta'); this.repintarCarritoFarmacia(); return; }
        const fefo = lotes[0];
        const aplicar = lote => { lin.lote_id = lote.lote_id; lin.sku = lote.sku; this.repintarCarritoFarmacia(); };
        if (fefo && nuevo.lote_id !== fefo.lote_id && String(nuevo.caducidad) > String(fefo.caducidad)) {
            this.avisarFefo({ lote: nuevo, alterno: fefo }, elegido => aplicar(elegido));
            this.repintarCarritoFarmacia();
            return;
        }
        aplicar(nuevo);
    },

    agregarLoteAlCarrito: function (loteId) {
        this.recibirEnCarrito(null, { lote_id: loteId });
    },

    pedirFolioRecetaCarrito: function (producto, op, cant, lineaId) {
        const S = BelenStore;
        const pac = this.pacienteCargoActual();
        if (!pac) { BelenUI.toast('Seleccione al paciente antes de cargar un antibiótico o controlado.', 'alerta'); return; }
        const previa = S.folioRecetaVigente(pac.turno_id, producto.sku);
        const medicos = Object.values(S.USUARIOS).filter(u => u.activo !== false && u.rol === 'medico');
        const turno = S.obtenerTurno(pac.turno_id);
        const e = t => this.e(t);
        const medicoInicial = (previa && previa.medico_id) || (turno && turno.medico_id) || (medicos[0] && medicos[0].id) || '';
        BelenUI.modal({
            titulo: 'Receta de ' + producto.nombre,
            subtitulo: S.etiquetaNormativa(producto.fraccion_cofepris),
            icono: 'fa-prescription',
            ancho: 'md',
            tipo: 'alerta',
            html: `<div class="space-y-3 text-left">
                <p class="text-xs text-slate-600">Este medicamento queda en la bitácora FEUM y en el Excel con el médico prescriptor y el folio de la receta.</p>
                <label class="block text-[11px] font-bold text-slate-500 uppercase">Médico prescriptor</label>
                <select id="rx-medico" class="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white">${medicos.map(m => `<option value="${e(m.id)}" ${m.id === medicoInicial ? 'selected' : ''}>${e(m.nombre)}</option>`).join('')}</select>
                <label class="block text-[11px] font-bold text-slate-500 uppercase">Folio de receta</label>
                <input id="rx-folio" value="${e(previa ? previa.folio : '')}" class="w-full border border-slate-300 rounded-lg p-2.5 text-sm" placeholder="REC-0001 o folio del recetario físico">
                <p class="text-[11px] text-slate-500">${previa ? 'Folio que el médico ya generó. Puede cambiarlo si la indicación fue en papel.' : 'Escriba el folio del papel físico, de la hoja de indicaciones o de la receta.'}</p>
                <p id="rx-error" class="text-xs text-red-600 hidden"></p>
            </div>`,
            botones: [
                { texto: 'Cancelar', estilo: 'secundario' },
                { texto: 'Confirmar y agregar', estilo: 'primario', alPulsar: c => {
                    const error = c.el.querySelector('#rx-error');
                    const folio = c.el.querySelector('#rx-folio').value.trim();
                    const medicoId = c.el.querySelector('#rx-medico').value;
                    const medico = medicos.find(m => m.id === medicoId);
                    if (folio.length < 3) { error.textContent = 'Indique el folio de la receta.'; error.classList.remove('hidden'); return false; }
                    if (!medico) { error.textContent = 'Seleccione al médico prescriptor.'; error.classList.remove('hidden'); return false; }
                    const inferido = BelenStore.inferirTipoRespaldo(folio, producto.fraccion_cofepris);
                    const enPiso = this.pacienteCargoActual() && this.pacienteCargoActual().area !== 'consulta';
                    const tipo = inferido || (this.modoExterno || !enPiso ? 'Receta Externa (EXT)' : 'Indicaciones Hospitalarias (IND)');
                    const cedula = BelenStore.cedulaDeUsuario(medico.id);
                    if (lineaId) {
                        const lin = this.carritoFarmacia.find(l => l.linea_id === lineaId);
                        if (lin) {
                            lin.folio_receta = folio.toUpperCase();
                            lin.medico_prescriptor_id = medico.id;
                            lin.medico_prescriptor_nombre = medico.nombre;
                            lin.cedula_prescriptor = cedula;
                            lin.tipo_respaldo = tipo;
                        }
                        this.render();
                        return;
                    }
                    this.recibirEnCarrito(null, Object.assign({}, op, {
                        lote_id: producto.lote_id, cantidad: cant, folio_confirmado: true,
                        folio_receta: folio, medico_prescriptor_id: medico.id, medico_prescriptor_nombre: medico.nombre,
                        cedula_prescriptor: cedula, tipo_respaldo: tipo
                    }));
                } }
            ]
        });
    },

    recibirEnCarrito: function (codigo, opciones) {
        let op = Object.assign({}, opciones || {});
        const r = BelenStore.prepararLineaCarrito(codigo, op);
        if (r.fefo) {
            this.avisarFefo(r, lote => this.recibirEnCarrito(null, Object.assign({}, op, { lote_id: lote.lote_id, ignorar_fefo: true })));
            return;
        }
        if (!r.ok) { BelenUI.toast(r.motivo, 'alerta'); return; }
        if (r.producto.fraccion_cofepris === 'I') {
            BelenUI.aviso('🔒 Estupefaciente Fracción I', '🔒 Estupefaciente Fracción I: No se puede cargar una caja ni piezas sueltas directo del almacén. Debe abrirse primero una Caja en la pestaña Estupefacientes Fracción I con los datos de la Receta Especial, y surtirse por ámpula desde las Cajas Abiertas.', 'alerta');
            return;
        }
        const fraccionReceta = r.producto.fraccion_cofepris;
        if (!op.folio_confirmado && !this.modoRetiroAdmin && !this.modoExterno && this.pacienteCargoId) {
            const auto = BelenStore.respaldoParaSurtido(this.pacienteCargoId, r.producto.sku);
            if (auto) {
                let cantAuto = parseInt(op.cantidad, 10) || 1;
                if (auto.pendiente && cantAuto > auto.pendiente) {
                    BelenUI.toast('De ' + auto.folio + ' solo faltan ' + auto.pendiente + ' piezas. Se carga esa cantidad.', 'alerta');
                    cantAuto = auto.pendiente;
                }
                op = Object.assign({}, op, {
                    cantidad: cantAuto, folio_confirmado: true, folio_receta: auto.folio,
                    medico_prescriptor_id: auto.medico_id, medico_prescriptor_nombre: auto.medico_nombre,
                    cedula_prescriptor: auto.cedula, tipo_respaldo: auto.tipo_respaldo
                });
            }
        }
        if ((fraccionReceta === 'II' || fraccionReceta === 'III' || fraccionReceta === 'IV_ANTIBIOTICO') && !op.folio_confirmado && !this.modoExterno) {
            this.pedirFolioRecetaCarrito(r.producto, op, parseInt(op.cantidad, 10) || 1);
            return;
        }
        const cant = parseInt(op.cantidad, 10) || 1;
        const ya = this.carritoFarmacia.filter(l => l.lote_id === r.producto.lote_id).reduce((s, l) => s + (l.cantidad || 1), 0);
        if (!op.servicio && r.producto.stock < ya + cant) { BelenUI.toast('No hay stock suficiente de ' + r.producto.nombre + '.', 'alerta'); return; }
        if (r.producto.fraccion_cofepris !== 'I') {
            const misma = this.carritoFarmacia.find(l => l.lote_id === r.producto.lote_id && !l.caja_id && l.paquete_id === (op.paquete_id || null));
            if (misma) {
                misma.cantidad += cant;
                if (op.confirmar_lote) misma.confirmar_lote = true;
                if (op.folio_receta) {
                    misma.folio_receta = op.folio_receta;
                    misma.medico_prescriptor_id = op.medico_prescriptor_id;
                    misma.medico_prescriptor_nombre = op.medico_prescriptor_nombre;
                    misma.cedula_prescriptor = op.cedula_prescriptor || '';
                    misma.tipo_respaldo = op.tipo_respaldo || '';
                }
                this.render();
                return;
            }
        }
        this.carritoFarmacia.push({
            linea_id: 'LIN-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
            lote_id: r.producto.lote_id, sku: r.producto.sku, confirmar_lote: !!op.confirmar_lote,
            cantidad: cant, ignorar_fefo: !!op.ignorar_fefo || !!op.lote_id,
            paquete_id: op.paquete_id || null, paquete_nombre: op.paquete_nombre || null, servicio: !!op.servicio,
            caja_id: op.caja_id || null, datos_postanestesicos: op.datos_postanestesicos || '',
            receta_previa: op.receta_previa || '', folio_receta_especial: op.folio_receta_especial || '',
            folio_receta: op.folio_receta || '', medico_prescriptor_id: op.medico_prescriptor_id || '',
            medico_prescriptor_nombre: op.medico_prescriptor_nombre || '',
            cedula_prescriptor: op.cedula_prescriptor || '', tipo_respaldo: op.tipo_respaldo || ''
        });
        this.render();
    },

    abrirUsoEstupefaciente: function (producto, opciones) {
        const S = BelenStore, e = t => this.e(t);
        const cajas = S.cajasAbiertasDe(producto.sku);
        const medicos = Object.values(S.USUARIOS).filter(u => u.activo !== false && u.rol === 'medico');
        const opcionesCaja = cajas.map(c => `<option value="${e(c.caja_id)}">${e(S.nombreAreaCaja(c.area_destino) || 'Sin área')} · ${e(c.folio_receta_especial)} · ${c.usadas}/${c.piezas_por_caja} ámpulas · lote ${e(c.lote)}</option>`).join('');
        BelenUI.modal({
            titulo: 'Fracción I · ' + producto.nombre, subtitulo: 'Una ámpula, una receta individual ligada a la caja.', icono: 'fa-prescription', ancho: 'lg', tipo: 'alerta',
            html: `<div class="space-y-3 text-left">
                <p class="text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">${e(S.etiquetaNormativa('I'))}</p>
                <label class="block text-[11px] font-bold text-slate-500 uppercase">Caja abierta</label>
                <select id="fen-caja" class="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white"><option value="">Abrir una caja nueva…</option>${opcionesCaja}</select>
                <div id="fen-nueva" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div class="sm:col-span-2"><label class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Área de destino / resguardo de la caja</label><select id="fen-area" class="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white"><option value="">Seleccione el área</option>${S.AREAS_CAJA.map(a => `<option value="${a.codigo}">${e(a.nombre)}</option>`).join('')}</select></div>
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
                        const area = c.el.querySelector('#fen-area').value;
                        if (!area) { error.textContent = 'Seleccione el área de destino de la caja.'; error.classList.remove('hidden'); return false; }
                        const abierta = S.abrirCajaEstupefaciente({ lote_id: producto.lote_id, folio_receta_especial: c.el.querySelector('#fen-folio').value, responsable_id: c.el.querySelector('#fen-responsable').value, area_destino: area }, this.sesion);
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
        const op = this.operadorFarmacia();
        if (!op) { BelenUI.toast('Identifíquese con su código personal para operar.', 'alerta'); return; }
        if (!this.carritoFarmacia.length) { BelenUI.toast('El carrito está vacío.', 'alerta'); return; }
        if (this.modoRetiroAdmin) {
            BelenUI.confirmar({
                titulo: 'Retiro directo de administración',
                mensaje: 'Se descontará del inventario a nombre de ' + op.nombre + ', con la fecha y hora de este momento. No se carga a ningún paciente.',
                textoConfirmar: 'Registrar salida',
                alConfirmar: () => this.ejecutarRetiroAdmin()
            });
            return;
        }
        if (this.modoExterno) {
            const necesita = this.carritoFarmacia.some(lin => {
                const p = BelenStore.listarInventarioFarmacia(this.sesion).find(x => x.lote_id === lin.lote_id);
                return p && !lin.folio_receta && (p.fraccion_cofepris === 'II' || p.fraccion_cofepris === 'III' || p.fraccion_cofepris === 'IV_ANTIBIOTICO');
            });
            if (necesita || this.carritoFarmacia.some(lin => !lin.folio_receta)) this.abrirDespachoExterno(necesita);
            else this.ejecutarDespachoExterno(null);
            return;
        }
        const paciente = this.pacienteCargoActual();
        if (!paciente) { BelenUI.toast('Seleccione al paciente activo.', 'alerta'); return; }
        const total = this.totalCarritoVisible();
        BelenUI.confirmar({
            titulo: 'Confirmar y cargar a cuenta',
            mensaje: 'Se cargará a ' + paciente.nombre + ' (' + paciente.cama + '). Retira: ' + op.nombre + '. Total ' + S.formatoMoneda(total) + '.',
            textoConfirmar: 'Confirmar y Cargar a Cuenta',
            alConfirmar: () => this.ejecutarCargoPaciente()
        });
    },

    totalCarritoVisible: function () {
        const inv = BelenStore.listarInventarioFarmacia(this.sesion);
        const base = this.carritoFarmacia.reduce((s, lin) => {
            const est = lin.estudio_id ? BelenStore.estudioPorCodigo(lin.sku) : null;
            const p = est ? null : inv.find(x => x.lote_id === lin.lote_id);
            const precio = est ? est.precio_unitario : (p ? p.precio_unitario : 0);
            return s + precio * (lin.cantidad || 1);
        }, 0);
        const ajuste = this.ajustesVisiblesCarrito().reduce((s, a) => s + a.subtotal, 0);
        return Math.round((base + ajuste) * 100) / 100;
    },

    ejecutarCargoPaciente: function () {
        const r = BelenStore.confirmarCarritoFarmacia({
            turno_id: this.pacienteCargoId,
            operador_id: (this.operadorFarmacia() || {}).id,
            lineas: this.carritoFarmacia
        }, this.sesion);
        if (r.fefo) {
            this.avisarFefo(r, lote => {
                const origen = r.lote.lote_id;
                const destino = lote.lote_id;
                this.carritoFarmacia.forEach(lin => {
                    if (lin.lote_id !== origen || lin.ignorar_fefo) return;
                    if (destino === origen) { lin.ignorar_fefo = true; return; }
                    const otra = this.carritoFarmacia.find(o => o !== lin && o.lote_id === destino && !o.caja_id && (o.paquete_id || null) === (lin.paquete_id || null));
                    if (otra) {
                        otra.cantidad = (otra.cantidad || 1) + (lin.cantidad || 1);
                        otra.ignorar_fefo = true;
                        lin._descartar = true;
                    } else {
                        lin.lote_id = destino;
                        lin.ignorar_fefo = true;
                    }
                });
                this.carritoFarmacia = this.carritoFarmacia.filter(l => !l._descartar);
                this.ejecutarCargoPaciente();
            });
            return;
        }
        if (!r.ok) { BelenUI.toast(r.motivo, 'alerta'); return; }
        this.carritoFarmacia = [];
        this.pacienteCargoId = null;
        BelenUI.toast('Cargo aplicado a la cuenta. Total del episodio ' + BelenStore.formatoMoneda(r.total) + '.', 'exito');
        const op = this.operadorFarmacia();
        if (op && BelenStore.puedeEmitirRecetaMedica(op.rol)) (r.recetas || []).forEach(rec => this.imprimirRecetaDatos(this.datosRecetaDe({
            nombre: rec.nombre, lote: rec.lote, laboratorio: '', fraccion_cofepris: 'I', sku: rec.sku
        }, { tipo: 'individual', numero: rec.numero, de: rec.de, folio_receta_especial: rec.folio_receta_especial, datos_postanestesicos: rec.datos_postanestesicos, dosis: rec.datos_postanestesicos })));
        this.render();
    },

    ejecutarRetiroAdmin: function () {
        const r = BelenStore.registrarRetiroAdministracion({ operador_id: (this.operadorFarmacia() || {}).id, lineas: this.carritoFarmacia }, this.sesion);
        if (!r.ok) { BelenUI.toast(r.motivo, 'alerta'); return; }
        this.carritoFarmacia = [];
        BelenUI.toast('Salida registrada en la bitácora a nombre de ' + this.operadorFarmacia().nombre + '.', 'exito');
        this.render();
    },

    datosRecetaDe: function (producto, extra) {
        const S = BelenStore;
        const paciente = this.pacienteCargoActual();
        const turno = paciente ? S.obtenerTurno(paciente.turno_id) : null;
        const medico = turno && S.USUARIOS[turno.medico_id];
        const pac = turno && S.buscarPacientePorId(turno.paciente_id);
        const internamiento = turno && S.internamientoDeTurno(turno.turno_id);
        const sv = (turno && turno.signos_vitales) || {};
        const esp = medico && S.especialidadPorCodigo(medico.especialidad_codigo);
        const camaReal = (internamiento && (internamiento.cama || internamiento.cama_codigo)) || (turno && (turno.cama || turno.cama_codigo)) || (paciente && paciente.cama);
        return S.datosReceta(Object.assign({
            producto: producto, paciente: paciente ? paciente.nombre : '',
            cama: camaReal ? (S.etiquetaCama(camaReal) || camaReal) : 'Por asignar por Enfermería',
            medico: medico ? medico.nombre : (turno && turno.medico_nombre) || '', cedula: medico ? S.resumenCedulas(medico) : '', cedulas_texto: medico ? S.textoCedulasFirma(medico) : '',
            denominacion: producto.nombre, dosis: extra && extra.dosis || producto.nombre, lote: producto.lote, laboratorio: producto.laboratorio,
            fraccion: producto.fraccion_cofepris,
            expediente: (turno && turno.paciente_id) || (pac && pac.paciente_id) || '',
            paciente_id: (turno && turno.paciente_id) || '',
            fecha_nacimiento: pac ? S.fechaLegibleISO(pac.fecha_nacimiento) : '',
            edad: (pac && pac.fecha_nacimiento && S.formatearEdad) ? S.formatearEdad(pac.fecha_nacimiento) : ((paciente && paciente.edad) || ''),
            peso: sv.peso_kg != null ? sv.peso_kg : '',
            talla: sv.talla_m != null ? sv.talla_m : '',
            alergias: (internamiento && internamiento.alergias) || 'NEGADAS',
            especialidad: (medico && S.especialidadImpresaMedico ? S.especialidadImpresaMedico(medico) : '') || (esp && esp.nombre) || (medico && medico.cargo) || (turno && turno.especialidad) || ''
        }, extra || {}));
    },

    imprimirRecetaLinea: function (lineaId) {
        const lin = this.carritoFarmacia.find(l => l.linea_id === lineaId);
        const p = lin && BelenStore.listarInventarioFarmacia(this.sesion).find(x => x.lote_id === lin.lote_id);
        if (!p) { BelenUI.toast('Esa línea ya no está en el carrito.', 'alerta'); return; }
        this.imprimirRecetaDatos(this.datosRecetaDe(p, { dosis: p.nombre, tipo: 'respaldo' }));
    },

    imprimirEnDashboard: function (html) {
        const zona = document.getElementById('print-dashboard');
        if (!zona) { BelenUI.toast('No se encontró la zona de impresión.', 'alerta'); return; }
        zona.innerHTML = html;
        const limpiar = () => { zona.innerHTML = ''; window.removeEventListener('afterprint', limpiar); };
        window.addEventListener('afterprint', limpiar);
        window.print();
    },

    imprimirRecetaDatos: function (datos) {
        this.imprimirEnDashboard(BelenStore.htmlCuerpoReceta(datos));
    },

    htmlRespaldoKiosco: function (elegido) {
        if (!elegido) return '';
        const S = BelenStore, e = t => this.e(t);
        const turno = S.obtenerTurno(elegido.turno_id);
        if (!turno) return '';
        const pendientes = r => (r.items || []).filter(i => (parseInt(i.cantidad_prescrita, 10) || 0) > 0 && (S.pendienteFolioSku(r.folio, i.sku) || 0) > 0);
        const tarjetaReceta = r => {
            const items = pendientes(r);
            if (!items.length) return '';
            const lista = items.map(i => `<li>${e(i.cantidad_prescrita)} × ${e(i.nombre)}${i.dosis_indicacion ? ' · ' + e(i.dosis_indicacion) : ''} <span class="text-slate-500">(${e(S.textoSurtidoItem(i))})</span></li>`).join('');
            return `<div class="mt-3 rounded-2xl border-2 border-rose-400 bg-white px-4 py-3">
                <p class="text-sm font-extrabold text-rose-950">💉 Indicado por ${e(r.medico_nombre || 'el médico')}${elegido.area === 'consulta' ? ' en Consulta' : ''} (Folio ${e(r.folio)})</p>
                <ul class="mt-2 text-sm text-slate-800 list-disc pl-4">${lista}</ul>
                <button type="button" onclick="AdminController.cargarRecetaAlCarrito('${e(r.receta_id)}')" class="mt-3 bg-rose-700 hover:bg-rose-800 text-white text-xs font-extrabold px-3 py-2 rounded-lg">+ Cargar al Carrito con un Clic</button>
            </div>`;
        };
        const recetas = S.recetasDeTurno(turno.turno_id).filter(r => r.tipo_origen === 'APLICACION_CONSULTA' && r.estatus_surtido !== 'CANCELADA');
        if (elegido.area === 'consulta') return recetas.map(tarjetaReceta).join('');
        const internamiento = S.internamientoDeTurno(turno.turno_id);
        const hoja = internamiento && S.indicacionesVigentes(internamiento);
        const texto = hoja ? [hoja.medicamentos, hoja.soluciones_parenterales].filter(Boolean).join('\n') : '';
        const indicacion = hoja ? `<div class="mt-3 rounded-2xl border-2 border-cyan-500 bg-white px-4 py-3">
            <p class="text-sm font-extrabold text-cyan-950">📋 Indicaciones Médicas Vigentes (Folio ${e(hoja.folio)} — ${e(hoja.autor_nombre || turno.medico_nombre || '')})</p>
            <p class="mt-2 text-sm text-slate-800 whitespace-pre-line">${e(texto || 'Sin medicamentos en la hoja vigente.')}</p>
            <p class="mt-2 text-[11px] text-cyan-900">Al escanear un antibiótico se enlaza ${e(hoja.folio)}. Si era una indicación en papel, use «Folio en papel» en la línea del carrito.</p>
        </div>` : '';
        const retenidas = S.recetasDeTurno(turno.turno_id).filter(r => r.tipo_origen !== 'RECETA_CASA' && r.estatus_surtido !== 'CANCELADA').map(r => {
            const control = (r.items || []).filter(i => {
                const prod = S.productoPorSku(i.sku);
                return prod && (prod.fraccion_cofepris === 'II' || prod.fraccion_cofepris === 'III' || prod.fraccion_cofepris === 'I') && (S.pendienteFolioSku(r.folio, i.sku) || 0) > 0;
            });
            if (!control.length) return '';
            return tarjetaReceta(Object.assign({}, r, { items: control.concat((r.items || []).filter(i => control.indexOf(i) < 0 && (S.pendienteFolioSku(r.folio, i.sku) || 0) > 0)) }));
        }).join('');
        return indicacion + retenidas;
    },

    htmlResultadoFolioReceta: function () {
        if (!this.folioBuscadoId) return '';
        const S = BelenStore, e = t => this.e(t);
        const r = S.listarRecetas().find(x => x.receta_id === this.folioBuscadoId);
        if (!r) return '';
        if (r.tipo_origen === 'RECETA_CASA') {
            return `<div class="mb-3 rounded-xl border border-cyan-300 bg-cyan-50 px-3 py-3">
                <p class="text-sm font-extrabold text-cyan-950">${e(r.folio)} · Receta para casa</p>
                <p class="text-xs text-cyan-900 mt-1">Esta receta no entra a la cola de surtido de clínica. El paciente la lleva impresa.</p>
            </div>`;
        }
        const filas = (r.items || []).map(i => {
            const pendiente = (parseInt(i.cantidad_prescrita, 10) || 0) > 0 ? (S.pendienteFolioSku(r.folio, i.sku) || 0) : (r.estatus_surtido === 'COMPLETA_RETENIDA' ? 0 : 1);
            const boton = pendiente > 0
                ? `<button type="button" onclick="AdminController.surtirPiezaDeReceta('${e(r.receta_id)}','${e(i.sku)}')" class="ml-2 bg-teal-700 text-white text-[11px] font-bold px-2 py-1 rounded-lg">Surtir 1 pieza</button>`
                : '<span class="ml-2 text-[11px] font-bold text-emerald-700">Completa</span>';
            return `<li class="py-1">${e(i.nombre)} · ${e(S.textoSurtidoItem(i))}${boton}</li>`;
        }).join('');
        const cierre = r.estatus_surtido === 'COMPLETA_RETENIDA' ? 'COMPLETA_RETENIDA · Retener receta física' : (r.estatus_surtido === 'PARCIAL_SELLADA' ? 'PARCIAL_SELLADA' : 'PENDIENTE');
        return `<div class="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-3">
            <p class="text-sm font-extrabold text-amber-950">${e(r.folio)} · ${e(r.paciente_nombre || 'Paciente')} · ${e(r.medico_nombre || '')}</p>
            <p class="text-[11px] font-bold text-amber-800 mt-1">${e(cierre)}</p>
            <ul class="mt-2 text-sm text-slate-800">${filas}</ul>
        </div>`;
    },

    cargarRecetaAlCarrito: function (recetaId) {
        const receta = BelenStore.listarRecetas().find(r => r.receta_id === recetaId);
        const lineas = BelenStore.lineasSugeridasDeReceta(receta);
        if (!lineas.length) { BelenUI.toast('No hay piezas pendientes con stock para esa receta.', 'alerta'); return; }
        lineas.forEach(lin => this.recibirEnCarrito(null, lin));
        BelenUI.toast('Medicamentos de ' + receta.folio + ' cargados con el médico y el folio.', 'exito');
    },

    surtirPiezaDeReceta: function (recetaId, sku) {
        const S = BelenStore;
        const receta = S.listarRecetas().find(r => r.receta_id === recetaId);
        const lineas = S.lineasSugeridasDeReceta(receta, sku, 1);
        if (!lineas.length) { BelenUI.toast('Esa receta ya no tiene piezas pendientes o no hay stock.', 'alerta'); return; }
        const turno = receta && receta.turno_id ? S.obtenerTurno(receta.turno_id) : null;
        const grupos = S.pacientesTerminalFarmacia(this.sesion);
        const activo = turno && ['hospital', 'observacion', 'quirofano', 'consulta'].some(k => (grupos[k] || []).some(p => p.turno_id === turno.turno_id));
        if (activo) { this.modoExterno = false; this.pacienteCargoId = turno.turno_id; }
        else { this.modoExterno = true; this.pacienteCargoId = null; }
        this.folioBuscadoId = receta.receta_id;
        this.folioBuscadoTexto = receta.folio;
        this.recibirEnCarrito(null, lineas[0]);
    },

    cambiarFolioLinea: function (lineaId) {
        const lin = this.carritoFarmacia.find(l => l.linea_id === lineaId);
        if (!lin) return;
        const p = BelenStore.listarInventarioFarmacia(this.sesion).find(x => x.lote_id === lin.lote_id);
        if (!p) { BelenUI.toast('Esa línea ya no está en el inventario.', 'alerta'); return; }
        this.pedirFolioRecetaCarrito(p, { cantidad: lin.cantidad }, lin.cantidad, lineaId);
    },

    abrirDespachoExterno: function (controlado) {
        const e = t => this.e(t);
        const extra = controlado ? `<label class="block text-[11px] font-bold text-slate-500 uppercase">Médico externo</label>
                <input id="ext-medico" class="w-full border border-slate-300 rounded-lg p-2.5 text-sm" placeholder="Nombre del médico">
                <label class="block text-[11px] font-bold text-slate-500 uppercase">Cédula profesional</label>
                <input id="ext-cedula" class="w-full border border-slate-300 rounded-lg p-2.5 text-sm" placeholder="Cédula">
                <label class="block text-[11px] font-bold text-slate-500 uppercase">Institución / domicilio del médico</label>
                <input id="ext-institucion" class="w-full border border-slate-300 rounded-lg p-2.5 text-sm">
                <label class="block text-[11px] font-bold text-slate-500 uppercase">Folio impreso en la receta física</label>
                <input id="ext-folio" class="w-full border border-slate-300 rounded-lg p-2.5 text-sm" placeholder="Déjelo vacío si no trae folio">
                <p class="text-[11px] text-slate-500">Si no trae folio, se asigna EXT-00001 y hay que anotarlo en el papel.</p>
                <div class="flex flex-col gap-1 text-sm">
                    <label class="flex items-center gap-2"><input type="radio" name="ext-disposicion" value="parcial" checked> Surtido parcial (se sella y se devuelve)</label>
                    <label class="flex items-center gap-2"><input type="radio" name="ext-disposicion" value="completa"> Surtido completo (se retiene la receta)</label>
                </div>` : '<p class="text-xs text-slate-500">Este despacho no lleva antibiótico ni controlado. Solo queda el paciente en la bitácora.</p>';
        BelenUI.modal({
            titulo: 'Receta externa',
            subtitulo: controlado ? 'Datos normativos del mostrador' : 'Paciente de mostrador',
            icono: 'fa-file-prescription',
            ancho: 'md',
            html: `<div class="space-y-3 text-left">
                <label class="block text-[11px] font-bold text-slate-500 uppercase">Nombre del paciente externo</label>
                <input id="ext-paciente" class="w-full border border-slate-300 rounded-lg p-2.5 text-sm">
                <label class="block text-[11px] font-bold text-slate-500 uppercase">Teléfono</label>
                <input id="ext-telefono" class="w-full border border-slate-300 rounded-lg p-2.5 text-sm">
                <label class="block text-[11px] font-bold text-slate-500 uppercase">Dirección</label>
                <input id="ext-direccion" class="w-full border border-slate-300 rounded-lg p-2.5 text-sm">
                ${extra}
                <p id="ext-error" class="text-xs text-red-600 hidden"></p>
            </div>`,
            botones: [
                { texto: 'Cancelar', estilo: 'secundario' },
                { texto: 'Surtir', estilo: 'primario', alPulsar: c => {
                    const v = id => { const n = c.el.querySelector(id); return n ? n.value : ''; };
                    const marca = c.el.querySelector('input[name="ext-disposicion"]:checked');
                    const datos = {
                        paciente_nombre: v('#ext-paciente'), telefono: v('#ext-telefono'), direccion: v('#ext-direccion'),
                        medico_nombre: v('#ext-medico'), cedula: v('#ext-cedula'), institucion: v('#ext-institucion'),
                        folio_fisico: v('#ext-folio'), disposicion: marca ? marca.value : ''
                    };
                    const error = c.el.querySelector('#ext-error');
                    if (!datos.paciente_nombre.trim()) { error.textContent = 'Indique el nombre del paciente.'; error.classList.remove('hidden'); return false; }
                    if (controlado && (!datos.medico_nombre.trim() || !datos.cedula.trim())) { error.textContent = 'Indique médico y cédula.'; error.classList.remove('hidden'); return false; }
                    this.ejecutarDespachoExterno(datos);
                } }
            ]
        });
    },

    ejecutarDespachoExterno: function (externo) {
        const r = BelenStore.confirmarSurtidoMostrador({
            operador_id: (this.operadorFarmacia() || {}).id,
            lineas: this.carritoFarmacia,
            externo: externo || {}
        }, this.sesion);
        if (!r.ok) { BelenUI.toast(r.motivo, 'alerta'); return; }
        this.carritoFarmacia = [];
        const folio = r.folio;
        if (r.generado && folio) {
            const texto = r.disposicion === 'completa' ? 'Surtido completo: se retiene la receta.' : 'Surtido parcial: se sella y se devuelve.';
            BelenUI.aviso('Anote el folio ' + folio + ' en la receta física', texto, 'exito');
        } else BelenUI.toast(folio ? 'Surtido registrado en ' + folio + '.' : 'Surtido de mostrador registrado.', 'exito');
        this.render();
    },

    htmlOrdenesAplicacion: function (turnoId) {
        const turno = BelenStore.obtenerTurno(turnoId);
        const ordenes = (turno && turno.ordenes_aplicacion) || [];
        if (!ordenes.length) return '';
        const e = t => this.e(t);
        const bloques = ordenes.map(o => {
            const items = (o.items || []).map(i => `<li>${e(i.cantidad_prescrita)} × ${e(i.nombre)} · ${e(i.dosis_indicacion || 'sin indicación')}</li>`).join('');
            return `<div class="mt-3 rounded-xl bg-white border border-teal-200 px-3 py-2">
                <p class="text-xs font-extrabold text-teal-900">Orden de aplicación ${e(o.folio)} · ${e(BelenStore.fechaHoraLegible(o.fecha_hora))}</p>
                <p class="text-[11px] text-teal-800">${e(o.medico_nombre || '')}</p>
                <ul class="mt-1 text-sm text-slate-800 list-disc pl-4">${items}</ul>
            </div>`;
        }).join('');
        return `<div class="mt-3"><p class="text-[11px] font-extrabold uppercase tracking-wide text-teal-800">Para aplicar ahora en clínica</p>${bloques}</div>`;
    },

    filtrarArchivoRecetas: function (texto, fraccion) {
        if (texto !== undefined) this.filtroRecetasTexto = String(texto || '');
        if (fraccion !== undefined) this.filtroRecetasFraccion = String(fraccion || '');
        this.render();
    },

    htmlArchivoRecetas: function (pacienteId) {
        const e = t => this.e(t);
        const S = BelenStore;
        let lista = S.listarRecetas().slice().reverse();
        if (pacienteId) lista = lista.filter(r => r.paciente_id === pacienteId);
        const q = String(this.filtroRecetasTexto || '').trim().toLowerCase();
        const fracFiltro = String(this.filtroRecetasFraccion || '').trim();
        if (!pacienteId && q) {
            lista = lista.filter(r => {
                const meds = (r.items || []).map(i => i.nombre || '').join(' ');
                const blob = [r.folio, r.paciente_nombre, r.medico_nombre, meds, r.diagnostico].join(' ').toLowerCase();
                return blob.indexOf(q) >= 0;
            });
        }
        if (!pacienteId && fracFiltro) {
            lista = lista.filter(r => (r.items || []).some(i => String(i.fraccion_cofepris || '') === fracFiltro));
        }
        const barraFiltro = pacienteId ? '' : `<div class="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-2">
            <input type="search" value="${e(this.filtroRecetasTexto || '')}" placeholder="Buscar por folio SB-REC, paciente, médico o medicamento…"
                oninput="AdminController.filtrarArchivoRecetas(this.value, undefined)"
                class="flex-1 min-w-[220px] border border-slate-300 rounded-lg px-3 py-1.5 text-xs bg-white">
            <select onchange="AdminController.filtrarArchivoRecetas(undefined, this.value)" class="border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white">
                <option value="" ${!fracFiltro ? 'selected' : ''}>Todas las fracciones COFEPRIS</option>
                <option value="I" ${fracFiltro === 'I' ? 'selected' : ''}>Fracción I (Estupefacientes)</option>
                <option value="II" ${fracFiltro === 'II' ? 'selected' : ''}>Fracción II (Psicotrópicos retención)</option>
                <option value="III" ${fracFiltro === 'III' ? 'selected' : ''}>Fracción III (Psicotrópicos sello)</option>
                <option value="IV_ANTIBIOTICO" ${fracFiltro === 'IV_ANTIBIOTICO' ? 'selected' : ''}>Fracción IV Antibiótico</option>
            </select>
        </div>`;
        if (!lista.length) return `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">${barraFiltro}<div class="p-8 text-sm text-slate-500 text-center">No hay recetas foliadas que coincidan con el filtro.</div></div>`;
        const filas = lista.map(r => {
            const meds = (r.items || []).map(i => {
                const fr = i.fraccion_cofepris && i.fraccion_cofepris !== 'IV' && i.fraccion_cofepris !== 'NA'
                    ? ` <span class="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300">Fracc. ${e(i.fraccion_cofepris)}</span>` : '';
                return `<span class="block text-xs text-slate-700">• <b>${e(i.nombre)}</b>${i.dosis_indicacion ? ' — ' + e(i.dosis_indicacion) : ''}${fr}</span>`;
            }).join('') || `<span class="text-xs text-slate-500">${e((r.receta_texto || '').slice(0, 90))}</span>`;
            return `<tr class="border-t border-slate-100 hover:bg-slate-50/70">
            <td class="px-3 py-3 font-extrabold text-slate-900 whitespace-nowrap">${e(r.folio)}<span class="block text-[10px] font-normal text-slate-400">${e(r.tipo_origen === 'RECETA_CASA' ? 'Receta a casa' : 'Aplicación clínica')}</span></td>
            <td class="px-3 py-3 text-xs whitespace-nowrap">${e(S.fechaHoraLegible(r.fecha_hora))}</td>
            <td class="px-3 py-3 font-semibold">${e(r.paciente_nombre)}<span class="block text-[11px] font-normal text-slate-500">${e(r.medico_nombre)}</span></td>
            <td class="px-3 py-3">${meds}</td>
            <td class="px-3 py-3 text-xs">${e(S.etiquetaEstatusReceta(r.estatus_surtido))}</td>
            <td class="px-3 py-3 text-right whitespace-nowrap"><button type="button" onclick="AdminController.abrirHojaReceta('${e(r.receta_id)}')" class="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-3 py-1.5 rounded-lg">Ver / Reimprimir</button></td>
        </tr>`;
        }).join('');
        return `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div class="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h3 class="font-extrabold text-slate-800">Bitácora y Archivo Digital de Recetas Emitidas</h3>
                    <p class="text-xs text-slate-500">Cada hoja es inmutable. Los medicamentos controlados (Fracción I, II y III) generan su hoja independiente automáticamente al imprimir.</p>
                </div>
                <span class="text-xs font-extrabold bg-teal-700 text-white rounded-full px-3 py-1">${lista.length} recetas</span>
            </div>
            ${barraFiltro}
            <div class="overflow-x-auto">
                <table class="w-full text-sm text-left"><thead class="text-[11px] uppercase text-slate-400 bg-slate-50"><tr>
                    <th class="px-3 py-2">Folio</th><th class="px-3 py-2">Fecha</th><th class="px-3 py-2">Paciente / Médico</th><th class="px-3 py-2">Prescripción / Fracción</th><th class="px-3 py-2">Surtido</th><th></th>
                </tr></thead><tbody>${filas}</tbody></table>
            </div></div>`;
    },

    abrirRecetasPaciente: function (pacienteId) {
        const p = BelenStore.buscarPacientePorId(pacienteId);
        BelenUI.modal({
            titulo: 'Recetas de ' + ((p && p.nombre_completo) || 'paciente'),
            icono: 'fa-file-prescription',
            ancho: 'xl',
            html: this.htmlArchivoRecetas(pacienteId),
            botones: [{ texto: 'Cerrar', estilo: 'secundario' }]
        });
    },

    abrirHojaReceta: function (recetaId) {
        const receta = BelenStore.listarRecetas().find(r => r.receta_id === recetaId);
        if (!receta) { BelenUI.toast('No se encontró esa receta.', 'alerta'); return; }
        const html = BelenStore.htmlHojaReceta(receta);
        BelenUI.modal({
            titulo: receta.folio,
            subtitulo: 'Hoja inmutable',
            icono: 'fa-file-prescription',
            ancho: 'xl',
            html: html,
            botones: [
                { texto: 'Cerrar', estilo: 'secundario' },
                { texto: '🖨️ Reimprimir Receta para Firma', estilo: 'primario', alPulsar: () => { this.imprimirEnDashboard(html); return false; } }
            ]
        });
    },

    htmlPanelEstupefacientes: function (areaVista) {
        const S = BelenStore;
        if (S.areaResguardoDeSesion(this.sesion) !== areaVista) return '';
        const cajas = S.cajasDeArea(areaVista, true);
        const e = t => this.e(t);
        const cuerpo = cajas.length ? cajas.map(c => {
            const restantes = BelenStore.restantesCaja(c);
            return `<div class="bg-white border border-rose-200 rounded-xl p-3 min-w-[220px]">
                <div class="text-[10px] font-bold uppercase text-rose-600">Caja activa</div>
                <div class="font-extrabold text-slate-800">${e(c.nombre)}</div>
                <div class="text-xs text-slate-500 mt-1">Lote ${e(c.lote)}${c.caducidad ? ' · Cad. ' + e(String(c.caducidad).slice(0, 10)) : ''}</div>
                <div class="text-xs text-slate-500">Folio ${e(c.folio_receta_especial)}</div>
                <div class="mt-2 text-sm font-extrabold text-rose-700">Ámpulas restantes: ${restantes} de ${e(c.piezas_por_caja)}</div>
            </div>`;
        }).join('') : `<p class="text-sm text-rose-700">No hay una caja activa asignada a ${e(S.nombreAreaCaja(areaVista))}.</p>`;
        return `<section class="mb-6 bg-rose-50 border border-rose-200 rounded-2xl p-4">
            <h3 class="font-extrabold text-rose-900 mb-3"><i class="fas fa-syringe mr-1"></i> Estupefacientes en resguardo · ${e(S.nombreAreaCaja(areaVista))}</h3>
            <div class="flex flex-wrap gap-3">${cuerpo}</div></section>`;
    },

    htmlBitacoraFarmacia: function () {
        const op = this.operadorFarmacia();
        if (!op || !BelenStore.permisoAccionDe(op.id, 'ver_bitacora_farmacia')) return '<div class="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">Su perfil no tiene la bitácora de farmacia.</div>';
        const S = BelenStore, f = this.filtrosBitacora, e = t => this.e(t);
        const ctx = this.contextoOperadorFarmacia();
        const personas = S.personasBitacora(ctx);
        const presentaciones = S.presentacionesBitacora(ctx);
        const lotes = f.medicamento ? S.lotesDePresentacion(ctx, f.medicamento) : [];
        return `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 mb-4">
            <p class="text-sm text-slate-500 mb-3">Solo medicamentos. Material de curación, estudios y servicios quedan fuera de este reporte.</p>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div><label class="block text-[11px] font-bold text-slate-500 uppercase mb-1" for="bit-desde">Desde</label><input id="bit-desde" type="date" value="${e(f.desde)}" oninput="AdminController.leerFiltrosBitacora()" class="w-full border border-slate-300 rounded-lg p-2 text-sm"></div>
                <div><label class="block text-[11px] font-bold text-slate-500 uppercase mb-1" for="bit-hasta">Hasta</label><input id="bit-hasta" type="date" value="${e(f.hasta)}" oninput="AdminController.leerFiltrosBitacora()" class="w-full border border-slate-300 rounded-lg p-2 text-sm"></div>
                <div><label class="block text-[11px] font-bold text-slate-500 uppercase mb-1" for="bit-tipo">Tipo de movimiento</label><select id="bit-tipo" onchange="AdminController.leerFiltrosBitacora()" class="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white"><option value="" ${f.tipo === '' ? 'selected' : ''}>Todos (Entradas y Salidas)</option><option value="ENTRADA" ${f.tipo === 'ENTRADA' ? 'selected' : ''}>Solo Entradas (Ingresos)</option><option value="SALIDA" ${f.tipo === 'SALIDA' ? 'selected' : ''}>Solo Salidas (Egresos)</option></select></div>
                <div><label class="block text-[11px] font-bold text-slate-500 uppercase mb-1" for="bit-persona">Personal / Enfermera</label><select id="bit-persona" onchange="AdminController.leerFiltrosBitacora()" class="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white"><option value="">Todas las personas</option>${personas.map(p => `<option value="${e(p.id)}" ${f.persona === p.id ? 'selected' : ''}>${e(p.nombre)} (${p.n} movs)</option>`).join('')}</select></div>
                <div class="sm:col-span-2"><label class="block text-[11px] font-bold text-slate-500 uppercase mb-1" for="bit-med">Medicamento / Presentación</label><input id="bit-med" list="bit-presentaciones" value="${e(f.medicamento)}" oninput="AdminController.actualizarLotesBitacora()" placeholder="Principio activo, concentración y forma" class="w-full border border-slate-300 rounded-lg p-2 text-sm"><datalist id="bit-presentaciones">${presentaciones.map(p => `<option value="${e(p)}"></option>`).join('')}</datalist></div>
                <div><label class="block text-[11px] font-bold text-slate-500 uppercase mb-1" for="bit-lote">Lote</label><select id="bit-lote" onchange="AdminController.leerFiltrosBitacora()" class="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white" ${lotes.length ? '' : 'disabled'}><option value="">Todos los lotes</option>${lotes.map(l => `<option value="${e(l)}" ${f.lote === l ? 'selected' : ''}>${e(l)}</option>`).join('')}</select></div>
                <div><label class="block text-[11px] font-bold text-slate-500 uppercase mb-1" for="bit-clase">Clasificación AWaRe / Fracción</label><select id="bit-clase" onchange="AdminController.leerFiltrosBitacora()" class="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white"><option value="" ${f.clasificacion === '' ? 'selected' : ''}>Todos</option><option value="CONTROLADOS" ${f.clasificacion === 'CONTROLADOS' ? 'selected' : ''}>Fracción I, II, III</option><option value="ANTIBIOTICOS" ${f.clasificacion === 'ANTIBIOTICOS' ? 'selected' : ''}>Antibióticos (Todos)</option><option value="ACCESO" ${f.clasificacion === 'ACCESO' ? 'selected' : ''}>AWaRe: Acceso</option><option value="VIGILANCIA" ${f.clasificacion === 'VIGILANCIA' ? 'selected' : ''}>AWaRe: Vigilancia</option><option value="RESERVA" ${f.clasificacion === 'RESERVA' ? 'selected' : ''}>AWaRe: Reserva</option></select></div>
            </div>
            <div class="flex flex-wrap gap-2 mt-4">
                <button type="button" onclick="AdminController.descargarBitacora()" class="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold px-4 py-2.5 rounded-xl">📊 Descargar Excel (.csv) con los Filtros Actuales</button>
            </div>
        </div>
        <div id="bitacora-carpetas">${this.htmlCarpetasBitacora()}</div>`;
    },

    leerFiltrosBitacora: function () {
        const v = id => { const n = document.getElementById(id); return n ? n.value : ''; };
        this.filtrosBitacora = { desde: v('bit-desde'), hasta: v('bit-hasta'), tipo: v('bit-tipo'), persona: v('bit-persona'), medicamento: v('bit-med'), lote: v('bit-lote'), clasificacion: v('bit-clase') };
        const caja = document.getElementById('bitacora-carpetas');
        if (caja) caja.innerHTML = this.htmlCarpetasBitacora();
    },

    alternarCarpetaBitacora: function (clave) {
        this.bitacoraAbiertas[clave] = !this.bitacoraAbiertas[clave];
        const caja = document.getElementById('bitacora-carpetas');
        if (caja) caja.innerHTML = this.htmlCarpetasBitacora();
    },

    htmlCarpetasBitacora: function () {
        const S = BelenStore, e = t => this.e(t);
        const lista = S.filtrarMovimientosFarmacia(this.contextoOperadorFarmacia(), this.filtrosBitacora);
        const anios = S.carpetasMovimientosFarmacia(lista);
        if (!anios.length) return '<div class="text-center py-16 text-slate-400 bg-white rounded-2xl border border-dashed border-slate-300">No hay medicamentos con esos filtros.</div>';
        const fila = m => {
            const piezas = m.tipo === 'ENTRADA' ? (m.total_piezas + ' pzas ingresadas' + (m.cajas_ingresadas ? ' · ' + m.cajas_ingresadas + ' cajas' : '')) : (m.cantidad_piezas + ' pzas retiradas');
            const contacto = m.tipo === 'SALIDA' && m.area_paciente !== 'RETIRO DIRECTO ADMINISTRACIÓN'
                ? `<span class="block text-[11px] text-slate-500">${e(m.paciente_telefono || 'Sin teléfono')} · ${e(m.paciente_direccion || 'Sin dirección')}</span>` : '';
            const destino = m.tipo === 'SALIDA' ? (m.area_paciente === 'RETIRO DIRECTO ADMINISTRACIÓN' ? 'Retiro directo de administración' : (m.paciente_nombre + ' · ' + m.area_paciente + (m.cama ? ' · ' + m.cama : '') + (m.medico_tratante ? ' · ' + m.medico_tratante : ''))) : (m.numero_factura ? 'Factura ' + m.numero_factura : 'Ingreso a almacén');
            const respaldo = m.tipo === 'SALIDA' && (m.tipo_respaldo || m.folio_receta || m.estatus_receta)
                ? `<span class="block text-[11px] text-slate-600">${e(m.tipo_respaldo || '')}${m.folio_receta ? ' · ' + e(m.folio_receta) : ''}${m.medico_prescriptor ? ' · ' + e(m.medico_prescriptor) : ''}${m.cedula_prescriptor ? ' · ' + e(m.cedula_prescriptor) : ''}${m.estatus_receta ? ' · ' + e(m.estatus_receta) : ''}</span>` : '';
            return `<tr class="border-t border-slate-100">
                <td class="px-3 py-2 whitespace-nowrap">${e(S.fechaHoraLegible(m.fecha_hora))}</td>
                <td class="px-3 py-2 font-bold ${m.tipo === 'ENTRADA' ? 'text-teal-800' : 'text-rose-800'}">${m.tipo === 'ENTRADA' ? 'Entrada' : (m.tipo === 'DEVOLUCION' ? 'Devolución' : (m.tipo === 'BAJA' ? 'Baja' : 'Salida'))}</td>
                <td class="px-3 py-2">${e(m.nombre)}<span class="block text-[11px] text-slate-400">${e(m.cedula_profesional || 'Sin cédula')}</span></td>
                <td class="px-3 py-2">${e(S.presentacionMovimiento(m) || m.principio_activo)}${m.nombre_comercial ? '<span class="block text-[11px] text-slate-400">' + e(m.nombre_comercial) + '</span>' : ''}<span class="block text-[11px] text-slate-400">${e(S.nombreFraccionCofepris(m.fraccion_cofepris))}${S.awareDeMovimiento(m) ? ' · ' + e((S.CLASIFICACION_AWARE.find(a => a.codigo === S.awareDeMovimiento(m)) || {}).nombre || S.awareDeMovimiento(m)) : ''} · lote ${e(m.lote)}</span></td>
                <td class="px-3 py-2">${e(piezas)}</td>
                <td class="px-3 py-2">${e(destino)}${contacto}${respaldo}${m.saldo_lote != null && m.saldo_lote !== '' ? '<span class="block text-[11px] text-slate-500">Saldo lote: ' + e(m.saldo_lote) + '</span>' : ''}${m.motivo ? '<span class="block text-[11px] text-amber-700">' + e(m.motivo) + '</span>' : ''}</td>
                <td class="px-3 py-2">${m.tipo === 'SALIDA' && S.puedeDevolverFarmacia && S.puedeDevolverFarmacia(this.sesion) ? `<button type="button" onclick="AdminController.abrirDevolucionFarmacia('${e(m.movimiento_id)}')" class="text-xs font-bold text-rose-700 hover:underline whitespace-nowrap">Devolver / Cancelar surtido</button>` : ''}</td>
            </tr>`;
        };
        return anios.map(anio => {
            const abierta = !!this.bitacoraAbiertas[anio.anio];
            const meses = anio.meses.map(mes => {
                const claveMes = anio.anio + '-' + mes.mes;
                const mesAbierto = !!this.bitacoraAbiertas[claveMes];
                const semanas = mes.semanas.map(sem => {
                    const claveSem = claveMes + '-' + sem.semana;
                    const semAbierta = !!this.bitacoraAbiertas[claveSem];
                    const tabla = semAbierta ? `<div class="overflow-x-auto -mx-1 px-1"><table class="w-full text-xs mt-2 min-w-[560px]"><thead class="text-[10px] uppercase text-slate-400"><tr><th class="px-3 py-1 text-left">Fecha</th><th class="px-3 py-1 text-left">Tipo</th><th class="px-3 py-1 text-left">Personal</th><th class="px-3 py-1 text-left">Producto</th><th class="px-3 py-1 text-left">Piezas</th><th class="px-3 py-1 text-left">Destino</th><th class="px-3 py-1 text-left">Acción</th></tr></thead><tbody>${sem.movimientos.map(fila).join('')}</tbody></table>` : '';
                    return `<div class="ml-4 mt-2"><button type="button" onclick="AdminController.alternarCarpetaBitacora('${claveSem}')" class="text-left text-sm font-bold text-slate-700"><i class="fas fa-folder${semAbierta ? '-open' : ''} text-amber-500 mr-2"></i>${e(sem.etiqueta)} <span class="text-[11px] font-medium text-slate-400">${sem.movimientos.length}</span></button>${tabla}</div>`;
                }).join('');
                return `<div class="ml-3 mt-2"><button type="button" onclick="AdminController.alternarCarpetaBitacora('${claveMes}')" class="text-left font-extrabold text-slate-800"><i class="fas fa-folder${mesAbierto ? '-open' : ''} text-teal-600 mr-2"></i>${e(mes.nombre)}</button>${mesAbierto ? semanas : ''}</div>`;
            }).join('');
            return `<section class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 mb-3"><button type="button" onclick="AdminController.alternarCarpetaBitacora('${e(anio.anio)}')" class="text-left text-lg font-extrabold text-slate-900"><i class="fas fa-folder${abierta ? '-open' : ''} text-slate-700 mr-2"></i>${e(anio.anio)}</button>${abierta ? meses : ''}</section>`;
        }).join('');
    },

    actualizarLotesBitacora: function () {
        const med = ((document.getElementById('bit-med') || {}).value || '').trim();
        const sel = document.getElementById('bit-lote');
        if (!sel) { this.leerFiltrosBitacora(); return; }
        const actual = sel.value;
        const lotes = BelenStore.lotesDePresentacion(this.contextoOperadorFarmacia(), med);
        sel.disabled = !lotes.length;
        sel.innerHTML = '<option value="">Todos los lotes</option>' + lotes.map(l => `<option value="${this.e(l)}">${this.e(l)}</option>`).join('');
        if (lotes.indexOf(actual) >= 0) sel.value = actual;
        this.leerFiltrosBitacora();
    },

    descargarBitacora: function () {
        this.leerFiltrosBitacora();
        const csv = BelenStore.csvMovimientosFarmacia(this.contextoOperadorFarmacia(), this.filtrosBitacora);
        if (!csv) { BelenUI.toast('Su perfil no puede descargar la bitácora.', 'alerta'); return; }
        const nombre = 'kardex-filtros.csv';
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = nombre;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },

    htmlEstupefacientesFarmacia: function () {
        const S = BelenStore, e = t => this.e(t);
        const cajas = S.listarCajasEstupefacientes(this.contextoOperadorFarmacia());
        const lista = cajas.length ? `<div class="flex flex-col gap-4">${cajas.map(c => {
            const rest = S.restantesCaja(c);
            const tot = c.ampulas_totales || c.piezas_por_caja || rest;
            const usos = (c.usos || []).map(u => `<li class="py-1">${e(S.fechaHoraLegible(u.fecha_hora))} · ${e(u.paciente_nombre)} · receta ${u.numero}/${u.de}${u.aplicador_nombre ? ' · ' + e(u.aplicador_nombre) : ''} · ${e(u.datos_postanestesicos || '')}</li>`).join('');
            return `<article class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                <h3 class="font-extrabold text-slate-900">${e(S.etiquetaCajaAbierta(c))}</h3>
                <p class="text-sm text-slate-600 mt-1">${e(c.nombre)} · caduca ${e(String(c.caducidad || '').slice(0, 10))}</p>
                <p class="text-sm font-extrabold text-rose-700 mt-1">Ámpulas restantes: ${rest} de ${tot}</p>
                <p class="text-xs text-slate-400 mt-1">Médico: ${e(c.responsable_nombre || '')}${c.responsable_cedula ? ' · cédula ' + e(c.responsable_cedula) : ''}${c.enfermera_nombre ? ' · recibe ' + e(c.enfermera_nombre) : ''}</p>
                ${usos ? `<ul class="mt-3 text-xs text-slate-600 border-t border-slate-100 pt-2">${usos}</ul>` : '<p class="text-xs text-slate-400 mt-3">Todavía no se usa ninguna ámpula de esta caja.</p>'}
            </article>`;
        }).join('')}</div>` : '<div class="text-center py-10 text-slate-400 bg-white rounded-2xl border border-dashed border-slate-300">No hay cajas de fracción I registradas.</div>';
        return `<div class="flex flex-wrap gap-2 mb-4">
            <button type="button" onclick="AdminController.abrirFormularioCajaEstupefaciente()" class="bg-rose-700 hover:bg-rose-800 text-white text-xs font-extrabold px-4 py-2.5 rounded-lg">Abrir caja del almacén</button>
            <button type="button" onclick="AdminController.abrirDispensarAmpula()" class="bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold px-4 py-2.5 rounded-lg">Dispensar / usar ámpula</button>
        </div>${lista}`;
    },

    abrirFormularioCajaEstupefaciente: function () {
        const S = BelenStore, e = t => this.e(t);
        const lotes = S.listarInventarioFarmacia(this.sesion).filter(p => p.fraccion_cofepris === 'I' && p.stock > 0);
        if (!lotes.length) { BelenUI.aviso('Sin cajas en almacén', 'No hay medicamento de Fracción I con stock para abrir una caja.', 'alerta'); return; }
        const medicos = Object.values(S.USUARIOS).filter(u => u.activo !== false && u.rol === 'medico');
        const enfermeras = S.enfermerasActivas();
        const cls = 'w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white';
        BelenUI.modal({
            titulo: 'Abrir caja de Fracción I', subtitulo: 'Descuenta una caja completa del almacén y la pasa al resguardo del área.', icono: 'fa-box-open', ancho: 'lg',
            html: `<div class="space-y-3 text-left">
                <label class="block text-[11px] font-bold text-slate-500 uppercase">Medicamento · lote · caducidad · piezas por caja</label>
                <select id="caja-lote" class="${cls}">${lotes.map(p => `<option value="${e(p.lote_id)}">${e(p.nombre)} · Lote ${e(p.lote)} · Cad. ${e(S.fechaLegibleISO(p.caducidad))} · ${p.piezas_por_caja} ámpulas/caja · stock ${p.stock}</option>`).join('')}</select>
                <label class="block text-[11px] font-bold text-slate-500 uppercase">Folio / código de barras de la receta física especial</label>
                <input id="caja-folio" maxlength="30" class="${cls}" placeholder="RE-2026-0001" data-autofoco>
                <label class="block text-[11px] font-bold text-slate-500 uppercase">Médico / responsable sanitario (nombre y cédula)</label>
                <select id="caja-medico" class="${cls}">${medicos.map(m => `<option value="${e(m.id)}">${e(m.nombre)} · cédula ${e(m.cedula_profesional || 'sin cédula')}</option>`).join('')}</select>
                <label class="block text-[11px] font-bold text-slate-500 uppercase">Enfermera que solicita y recibe la caja</label>
                <select id="caja-enf" class="${cls}">${enfermeras.map(n => `<option value="${e(n.id)}">${e(n.nombre)}</option>`).join('')}</select>
                <label class="block text-[11px] font-bold text-slate-500 uppercase">Área de resguardo</label>
                <select id="caja-area" class="${cls}"><option value="">Seleccione</option>${S.AREAS_CAJA.map(a => `<option value="${a.codigo}">${e(a.nombre)}</option>`).join('')}</select>
                <p id="caja-error" class="text-xs text-red-600 hidden"></p>
            </div>`,
            botones: [
                { texto: 'Cancelar', estilo: 'secundario' },
                { texto: 'Abrir caja y descontar almacén', estilo: 'exito', alPulsar: c => {
                    const r = S.abrirCajaEstupefaciente({
                        lote_id: c.el.querySelector('#caja-lote').value,
                        folio_receta_especial: c.el.querySelector('#caja-folio').value,
                        responsable_id: c.el.querySelector('#caja-medico').value,
                        enfermera_id: c.el.querySelector('#caja-enf').value,
                        area_destino: c.el.querySelector('#caja-area').value
                    }, this.sesion);
                    const error = c.el.querySelector('#caja-error');
                    if (!r.ok) { error.textContent = r.motivo; error.classList.remove('hidden'); return false; }
                    BelenUI.toast('Caja abierta. ' + r.caja.ampulas_totales + ' ámpulas pasaron a ' + S.nombreAreaCaja(r.caja.area_destino) + '.', 'exito');
                    this.pestanaFarmacia = 'estupefacientes';
                    this.render();
                } }
            ]
        });
    },

    abrirDispensarAmpula: function (turnoId) {
        const S = BelenStore, e = t => this.e(t);
        const cajas = S.listarCajas().filter(c => S.restantesCaja(c) > 0);
        if (!cajas.length) { BelenUI.aviso('Sin cajas abiertas', 'Abra primero una caja en Estupefacientes Fracción I. No se surte directo del almacén.', 'alerta'); return; }
        const grupos = S.pacientesTerminalFarmacia(this.sesion);
        const pacientes = [].concat(grupos.hospital || [], grupos.observacion || [], grupos.quirofano || [], grupos.consulta || []);
        const aplicadores = S.enfermerasActivas().concat(Object.values(S.USUARIOS).filter(u => u.activo !== false && u.rol === 'medico'));
        const cls = 'w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white';
        BelenUI.modal({
            titulo: 'Dispensar ámpula', subtitulo: 'El cargo es solo el precio de las ámpulas usadas, tomado de la caja abierta.', icono: 'fa-syringe', ancho: 'lg',
            html: `<div class="space-y-3 text-left">
                <label class="block text-[11px] font-bold text-slate-500 uppercase">Caja abierta</label>
                <select id="disp-caja" class="${cls}">${cajas.map(c => `<option value="${e(c.caja_id)}">${e(S.etiquetaCajaAbierta(c))}</option>`).join('')}</select>
                <label class="block text-[11px] font-bold text-slate-500 uppercase">Paciente</label>
                <select id="disp-turno" class="${cls}">${pacientes.map(p => `<option value="${e(p.turno_id)}" ${turnoId === p.turno_id ? 'selected' : ''}>${e(p.nombre)} · ${e(p.area_txt)} · ${e(p.cama)}</option>`).join('')}</select>
                <label class="block text-[11px] font-bold text-slate-500 uppercase">Enfermera o médico que la aplicó</label>
                <select id="disp-quien" class="${cls}">${aplicadores.map(u => `<option value="${e(u.id)}">${e(u.nombre)}</option>`).join('')}</select>
                <label class="block text-[11px] font-bold text-slate-500 uppercase">Ámpulas usadas</label>
                <input id="disp-cant" type="number" min="1" max="20" step="1" value="1" class="${cls}">
                <p id="disp-error" class="text-xs text-red-600 hidden"></p>
            </div>`,
            botones: [
                { texto: 'Cancelar', estilo: 'secundario' },
                { texto: 'Cargar ámpulas a la cuenta', estilo: 'exito', alPulsar: c => {
                    const caja = S.listarCajas().find(x => x.caja_id === c.el.querySelector('#disp-caja').value);
                    const r = S.dispensarAmpulas({
                        caja_id: c.el.querySelector('#disp-caja').value,
                        turno_id: c.el.querySelector('#disp-turno').value,
                        aplicador_id: c.el.querySelector('#disp-quien').value,
                        cantidad: c.el.querySelector('#disp-cant').value,
                        datos: caja ? caja.nombre : ''
                    }, this.sesion);
                    const error = c.el.querySelector('#disp-error');
                    if (!r.ok) { error.textContent = r.motivo; error.classList.remove('hidden'); return false; }
                    BelenUI.toast('Se cargaron ' + (r.usos || []).length + ' ámpula(s). Quedan ' + S.restantesCaja(r.caja) + '.', 'exito');
                    this.render();
                    const pac = S.obtenerTurno(r.uso.turno_id);
                    const medico = S.USUARIOS[r.uso.aplicador_id] || {};
                    const internamiento = pac && S.internamientoDeTurno(pac.turno_id);
                    const pacReg = pac && S.buscarPacientePorId(pac.paciente_id);
                    const sv = (pac && pac.signos_vitales) || {};
                    const esp = S.especialidadPorCodigo(medico.especialidad_codigo);
                    const camaReal = (internamiento && (internamiento.cama || internamiento.cama_codigo)) || (pac && (pac.cama || pac.cama_codigo));
                    const edadN = pacReg && pacReg.fecha_nacimiento ? S.calcularEdad(pacReg.fecha_nacimiento) : null;
                    this.imprimirRecetaDatos(S.datosReceta({
                        tipo: 'individual', producto: r.producto, paciente: pac ? pac.paciente_nombre : r.uso.paciente_nombre,
                        cama: camaReal ? (S.etiquetaCama(camaReal) || camaReal) : 'Por asignar por Enfermería',
                        medico: medico.nombre || r.uso.aplicador_nombre, cedula: S.resumenCedulas(medico), cedulas_texto: S.textoCedulasFirma(medico),
                        denominacion: r.producto.nombre, dosis: r.producto.nombre, lote: r.uso.lote, laboratorio: r.producto.laboratorio, fraccion: 'I',
                        numero: r.uso.numero, de: r.uso.de, folio_receta_especial: r.uso.folio_receta_especial, datos_postanestesicos: r.uso.datos_postanestesicos,
                        expediente: (pac && pac.paciente_id) || '',
                        fecha_nacimiento: pacReg ? S.fechaLegibleISO(pacReg.fecha_nacimiento) : '',
                        edad: (pacReg && pacReg.fecha_nacimiento && S.formatearEdad) ? S.formatearEdad(pacReg.fecha_nacimiento, edadN) : '',
                        peso: sv.peso_kg != null ? sv.peso_kg : '',
                        talla: sv.talla_m != null ? sv.talla_m : '',
                        alergias: (internamiento && internamiento.alergias) || 'NEGADAS',
                        especialidad: (S.especialidadImpresaMedico ? S.especialidadImpresaMedico(medico) : '') || (esp && esp.nombre) || medico.cargo || (pac && pac.especialidad) || ''
                    }));
                } }
            ]
        });
    },

    htmlPaquetesFarmacia: function () {
        const S = BelenStore, e = t => this.e(t);
        const paquetes = S.listarPaquetes();
        if (!paquetes.length) return '<div class="text-center py-16 text-slate-400 bg-white rounded-2xl border border-dashed border-slate-300">No hay paquetes. Cree el primero con Nuevo paquete.</div>';
        return `<div class="grid grid-cols-1 md:grid-cols-2 gap-4">${paquetes.map(p => {
            const items = p.items.map(it => {
                const est = S.estudioPorCodigo(it.sku);
                const prod = est ? null : S.productoPorSku(it.sku);
                const nombre = est ? est.nombre : (prod ? prod.nombre : it.sku);
                return `<li class="flex justify-between gap-3 py-1"><span>${e(nombre)}${est ? ' <span class="text-[10px] uppercase text-slate-400">estudio</span>' : ''}</span><span class="font-bold">${it.cantidad}×</span></li>`;
            }).join('');
            const suma = S.sumaRealPaquete(p.items);
            const pactado = p.precio_paquete != null && p.precio_paquete !== '' ? Number(p.precio_paquete) : null;
            return `<article class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                <h3 class="font-extrabold text-slate-900">${e(p.nombre)}</h3>
                <p class="text-sm text-slate-500 mt-1">Suma real de insumos y estudios: <b class="text-slate-800">${e(S.formatoMoneda(suma))}</b></p>
                ${pactado != null ? `<p class="text-sm font-bold text-emerald-800">Precio final de venta: ${e(S.formatoMoneda(pactado))}${pactado < suma ? ' · descuento ' + e(S.formatoMoneda(pactado - suma)) : ''}</p>` : '<p class="text-xs text-slate-400">Sin precio especial: cada ítem se cobra a su precio.</p>'}
                <ul class="mt-3 text-sm text-slate-600">${items}</ul>
                <div class="mt-4 flex flex-wrap gap-2">
                    <button type="button" onclick="AdminController.meterPaqueteEnCarrito('${e(p.paquete_id)}')" class="bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold px-3 py-2 rounded-lg">Aplicar al carrito</button>
                    <button type="button" onclick="AdminController.abrirEditorPaquete('${e(p.paquete_id)}')" class="bg-white border border-slate-300 text-xs font-bold px-3 py-2 rounded-lg">Editar</button>
                    <button type="button" onclick="AdminController.eliminarPaqueteFarmacia('${e(p.paquete_id)}')" class="text-red-600 text-xs font-bold px-3 py-2">Eliminar</button>
                </div>
            </article>`;
        }).join('')}</div>`;
    },

    fichaItemPaquete: function (sku) {
        const S = BelenStore;
        const est = S.estudioPorCodigo(sku);
        if (est) return { sku: est.codigo, nombre: est.nombre, extra: '', precio: est.precio_unitario, aplica_iva: !!est.aplica_iva, grupo: S.nombreTipoEstudio(est.categoria) };
        const prod = S.productoPorSku(sku);
        if (prod) return { sku: prod.sku, nombre: prod.nombre, extra: prod.nombre_comercial || '', precio: prod.precio_unitario, aplica_iva: !!prod.aplica_iva, grupo: prod.categoria === 'MATERIAL_CURACION' ? 'Material de curación' : 'Farmacia' };
        return { sku: sku, nombre: sku, extra: '', precio: 0, aplica_iva: false, grupo: 'Sin catálogo' };
    },

    buscarParaPaquete: function (texto) {
        const S = BelenStore, n = S.normalizar(texto);
        if (!n) return [];
        const out = [], vistos = {};
        S.listarInventarioFarmacia(this.sesion).forEach(p => {
            if (vistos[p.sku] || p.fraccion_cofepris === 'I') return;
            const blob = S.normalizar([p.nombre, p.nombre_comercial, p.sku, p.principio].filter(Boolean).join(' '));
            if (blob.indexOf(n) < 0) return;
            vistos[p.sku] = true;
            out.push(this.fichaItemPaquete(p.sku));
        });
        S.listarEstudios().forEach(est => {
            if (vistos[est.codigo]) return;
            if (S.normalizar(est.nombre + ' ' + est.codigo).indexOf(n) < 0) return;
            vistos[est.codigo] = true;
            out.push(this.fichaItemPaquete(est.codigo));
        });
        return out.slice(0, 12);
    },

    abrirEditorPaquete: function (paqueteId) {
        const S = BelenStore, e = t => this.e(t), self = this;
        const paq = paqueteId ? S.listarPaquetes().find(p => p.paquete_id === paqueteId) : null;
        BelenUI.modal({
            titulo: paq ? 'Editar paquete' : 'Nuevo paquete', icono: 'fa-kit-medical', ancho: 'lg',
            html: `<div class="space-y-3 text-left">
                <label class="block text-[11px] font-bold text-slate-500 uppercase">Nombre</label>
                <input id="paq-nombre" value="${e(paq ? paq.nombre : '')}" data-autofoco class="w-full border border-slate-300 rounded-lg p-2.5 text-sm">
                <label class="block text-[11px] font-bold text-slate-500 uppercase">Buscar en farmacia y tarifario</label>
                <input id="paq-busca" autocomplete="off" placeholder="Nombre, principio activo, nombre comercial o código" class="w-full border border-slate-300 rounded-lg p-2.5 text-sm">
                <div id="paq-coincidencias" class="hidden border border-slate-200 rounded-xl overflow-hidden bg-white"></div>
                <div class="overflow-x-auto border border-slate-200 rounded-xl">
                    <table class="w-full text-sm"><thead class="bg-slate-50 text-[11px] uppercase text-slate-400"><tr>
                        <th class="px-3 py-2 text-left">Ítem</th><th class="px-3 py-2 text-left">IVA del insumo</th><th class="px-3 py-2 text-center">Cantidad</th><th></th>
                    </tr></thead><tbody id="paq-items"></tbody></table>
                </div>
                <p id="paq-vacio" class="text-xs text-slate-400">La lista inicia vacía. Escriba para buscar y pulse una coincidencia.</p>
                <p id="paq-suma" class="text-sm font-extrabold text-slate-800">Suma real: ${e(S.formatoMoneda(0))}</p>
                <label class="block text-[11px] font-bold text-slate-500 uppercase">Precio final de venta del paquete (opcional)</label>
                <input id="paq-precio" type="number" min="0.01" step="0.01" value="${paq && paq.precio_paquete != null ? paq.precio_paquete : ''}" placeholder="Vacío = cobrar cada ítem a su precio" class="w-full border border-slate-300 rounded-lg p-2.5 text-sm">
                <p id="paq-ajuste" class="text-xs text-emerald-800"></p>
                <p id="paq-error" class="text-xs text-red-600 hidden"></p>
            </div>`,
            alMostrar: c => {
                const cuerpo = c.el.querySelector('#paq-items');
                const fila = (sku, cant) => {
                    const ficha = self.fichaItemPaquete(sku);
                    const tr = document.createElement('tr');
                    tr.className = 'border-t border-slate-100';
                    tr.setAttribute('data-fila-paq', '1');
                    tr.setAttribute('data-sku', ficha.sku);
                    tr.innerHTML = `<td class="px-3 py-2"><span class="block font-semibold text-slate-800">${e(ficha.nombre)}</span><span class="block text-[11px] text-slate-400">${e(ficha.grupo)} · ${e(ficha.sku)}${ficha.extra ? ' · ' + e(ficha.extra) : ''}</span></td>
                        <td class="px-3 py-2 text-xs font-bold ${ficha.aplica_iva ? 'text-amber-700' : 'text-slate-400'}">${ficha.aplica_iva ? 'Grava IVA' : 'Tasa 0%'}</td>
                        <td class="px-3 py-2"><div class="inline-flex items-center gap-1">
                            <button type="button" data-menos class="w-8 h-8 rounded-lg border border-slate-300 font-bold">−</button>
                            <input data-cant-paq type="number" min="1" max="99" value="${cant || 1}" class="w-16 border border-slate-300 rounded-lg p-1.5 text-sm text-center">
                            <button type="button" data-mas class="w-8 h-8 rounded-lg border border-slate-300 font-bold">+</button>
                        </div></td>
                        <td class="px-2 py-2"><button type="button" data-quitar-paq class="text-slate-400 hover:text-red-600 px-2" aria-label="Quitar ítem"><i class="fas fa-xmark"></i></button></td>`;
                    const cantInput = tr.querySelector('[data-cant-paq]');
                    const fijar = n => { cantInput.value = String(Math.max(1, Math.min(99, n))); pintar(); };
                    tr.querySelector('[data-menos]').addEventListener('click', () => fijar((parseInt(cantInput.value, 10) || 1) - 1));
                    tr.querySelector('[data-mas]').addEventListener('click', () => fijar((parseInt(cantInput.value, 10) || 1) + 1));
                    cantInput.addEventListener('input', pintar);
                    tr.querySelector('[data-quitar-paq]').addEventListener('click', () => { tr.remove(); pintar(); });
                    return tr;
                };
                const agregar = (sku, cant) => {
                    const ya = Array.from(cuerpo.querySelectorAll('[data-fila-paq]')).find(f => f.getAttribute('data-sku') === sku);
                    if (ya) {
                        const input = ya.querySelector('[data-cant-paq]');
                        input.value = String(Math.min(99, (parseInt(input.value, 10) || 1) + (cant || 1)));
                    } else cuerpo.appendChild(fila(sku, cant || 1));
                    pintar();
                };
                const pintar = () => {
                    const items = Array.from(cuerpo.querySelectorAll('[data-fila-paq]')).map(f => ({ sku: f.getAttribute('data-sku'), cantidad: f.querySelector('[data-cant-paq]').value }));
                    c.el.querySelector('#paq-vacio').classList.toggle('hidden', items.length > 0);
                    const suma = S.sumaRealPaquete(items);
                    c.el.querySelector('#paq-suma').textContent = 'Suma real: ' + S.formatoMoneda(suma);
                    const crudo = c.el.querySelector('#paq-precio').value.trim();
                    const nota = c.el.querySelector('#paq-ajuste');
                    const pactado = crudo === '' ? null : Math.round(Number(crudo) * 100) / 100;
                    if (pactado != null && pactado > 0 && pactado < suma) nota.textContent = 'Precio promocional ' + S.formatoMoneda(pactado) + '. Cada línea conserva si grava IVA. El descuento será ' + S.formatoMoneda(pactado - suma) + '.';
                    else if (pactado != null && pactado > 0) nota.textContent = 'El precio no es menor a la suma: cada ítem se cobra a su precio y conserva su IVA.';
                    else nota.textContent = 'Sin precio especial, cada ítem entra a su precio de catálogo.';
                };
                const coincidencias = c.el.querySelector('#paq-coincidencias');
                c.el.querySelector('#paq-busca').addEventListener('input', ev => {
                    const lista = self.buscarParaPaquete(ev.target.value);
                    if (!lista.length) { coincidencias.classList.add('hidden'); coincidencias.innerHTML = ''; return; }
                    coincidencias.classList.remove('hidden');
                    coincidencias.innerHTML = lista.map(it => `<button type="button" data-agregar="${e(it.sku)}" class="w-full text-left px-3 py-2 hover:bg-teal-50 border-t border-slate-100 first:border-0">
                        <span class="block text-sm font-semibold text-slate-800">${e(it.nombre)}</span>
                        <span class="block text-[11px] text-slate-500">${e(it.grupo)} · ${e(it.sku)}${it.extra ? ' · ' + e(it.extra) : ''} · ${e(S.formatoMoneda(it.precio))} · ${it.aplica_iva ? 'Grava IVA' : 'Tasa 0%'}</span>
                    </button>`).join('');
                    coincidencias.querySelectorAll('[data-agregar]').forEach(b => b.addEventListener('click', () => {
                        agregar(b.getAttribute('data-agregar'), 1);
                        c.el.querySelector('#paq-busca').value = '';
                        coincidencias.classList.add('hidden');
                        coincidencias.innerHTML = '';
                    }));
                });
                (paq ? paq.items : []).forEach(it => agregar(it.sku, it.cantidad));
                c.el.querySelector('#paq-precio').addEventListener('input', pintar);
                pintar();
            },
            botones: [
                { texto: 'Cancelar', estilo: 'secundario' },
                { texto: 'Guardar paquete', estilo: 'exito', alPulsar: c => {
                    const items = Array.from(c.el.querySelectorAll('[data-fila-paq]')).map(f => ({ sku: f.getAttribute('data-sku'), cantidad: f.querySelector('[data-cant-paq]').value }));
                    const r = S.guardarPaquete({ nombre: c.el.querySelector('#paq-nombre').value, items: items, precio_paquete: c.el.querySelector('#paq-precio').value }, this.sesion, paq ? paq.paquete_id : null);
                    const error = c.el.querySelector('#paq-error');
                    if (!r.ok) { error.textContent = (r.errores && (r.errores.nombre || r.errores.items || r.errores.precio_paquete)) || r.motivo; error.classList.remove('hidden'); return false; }
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
    // VISTA: TARIFARIO Y CAJA (admin y administrador)
    // ======================================================================
    cambiarPestanaTarifario: function (pestana) {
        this.pestanaTarifario = pestana === 'caja' ? 'caja' : 'catalogo';
        this.render();
    },
    filtrarCategoriaEstudio: function (codigo) {
        this.filtroCategoriaEstudio = codigo || '';
        const caja = document.getElementById('cuerpo-estudios');
        if (caja) caja.innerHTML = this.htmlFilasEstudios();
        document.querySelectorAll('[data-filtro-est]').forEach(b => {
            const on = b.getAttribute('data-filtro-est') === this.filtroCategoriaEstudio;
            b.classList.toggle('bg-slate-900', on); b.classList.toggle('text-white', on); b.classList.toggle('border-slate-900', on);
            b.classList.toggle('bg-white', !on); b.classList.toggle('text-slate-600', !on);
        });
    },
    filtrarTextoEstudio: function () {
        const q = document.getElementById('busca-estudio');
        this.buscaEstudio = q ? q.value : '';
        const caja = document.getElementById('cuerpo-estudios');
        if (caja) caja.innerHTML = this.htmlFilasEstudios();
    },
    estudiosVisiblesTarifario: function () {
        const S = BelenStore, n = S.normalizar(this.buscaEstudio || '');
        return S.listarEstudios().filter(est => {
            if (this.filtroCategoriaEstudio && est.categoria !== this.filtroCategoriaEstudio) return false;
            if (!n) return true;
            return S.normalizar(est.nombre + ' ' + est.codigo + ' ' + est.tubo_muestra).indexOf(n) >= 0;
        });
    },
    htmlFilasEstudios: function () {
        const S = BelenStore, e = t => this.e(t);
        const filas = this.estudiosVisiblesTarifario();
        if (!filas.length) return '<tr><td colspan="6" class="px-4 py-12 text-center text-slate-400">No hay estudios con ese filtro.</td></tr>';
        return filas.map(est => `<tr class="border-t border-slate-100 hover:bg-slate-50/80">
            <td class="px-3 py-3 font-mono text-xs font-bold">${e(est.codigo)}</td>
            <td class="px-3 py-3 font-semibold text-slate-900">${e(est.nombre)}</td>
            <td class="px-3 py-3 text-xs">${e(S.nombreTipoEstudio(est.categoria))}</td>
            <td class="px-3 py-3 text-xs">${(est.categoria === 'LABORATORIO' || est.categoria === 'PATOLOGIA') ? e(est.tubo_muestra || '—') : '—'}</td>
            <td class="px-3 py-3 font-bold">${this.rolActual === 'medico' ? '—' : e(S.formatoMoneda(est.precio_unitario))}${this.rolActual === 'medico' ? '' : est.aplica_iva ? '<span class="block text-[10px] font-normal text-amber-700">Grava 16% al facturar</span>' : '<span class="block text-[10px] font-normal text-slate-400">Tasa 0%</span>'}</td>
            <td class="px-3 py-3 text-right whitespace-nowrap">
                <button type="button" onclick="AdminController.abrirEditorEstudio('${e(est.estudio_id)}')" class="text-xs font-bold text-cyan-800 px-2 py-1">Editar</button>
                <button type="button" onclick="AdminController.confirmarEliminarEstudio('${e(est.estudio_id)}')" class="text-xs font-bold text-red-600 px-2 py-1">Eliminar</button>
            </td></tr>`).join('');
    },
    htmlTarifario: function () {
        const S = BelenStore, e = t => this.e(t);
        const tab = (id, txt) => {
            const on = this.pestanaTarifario === id;
            return `<button type="button" onclick="AdminController.cambiarPestanaTarifario('${id}')" class="px-4 py-2 rounded-lg text-sm font-bold transition ${on ? 'bg-white text-amber-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}">${txt}</button>`;
        };
        const cuerpo = this.pestanaTarifario === 'caja' ? this.htmlAuditoriaCaja() : this.htmlCatalogoEstudios();
        return `<div class="mb-4"><h2 class="text-2xl font-extrabold text-slate-800">Tarifario y Caja</h2>
            <p class="text-slate-500">Catálogo de estudios y auditoría de cuentas. El total se muestra sin IVA; el 16% se suma solo si piden factura.</p></div>
            <div class="inline-flex flex-wrap bg-slate-100 rounded-xl p-1 mb-5 gap-1">${tab('catalogo', 'Catálogo de estudios')}${tab('caja', 'Auditoría Detallada de Cuentas y Caja')}</div>
            ${cuerpo}`;
    },
    htmlCatalogoEstudios: function () {
        const S = BelenStore, e = t => this.e(t);
        const chip = (codigo, texto) => {
            const on = this.filtroCategoriaEstudio === codigo;
            return `<button type="button" data-filtro-est="${e(codigo)}" onclick="AdminController.filtrarCategoriaEstudio('${e(codigo)}')" class="px-3 py-1.5 rounded-full text-xs font-bold border ${on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'}">${texto}</button>`;
        };
        return `<div class="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div class="flex flex-wrap gap-2">${chip('', 'Todos')}${S.TIPOS_ESTUDIO.map(t => chip(t.codigo, t.nombre)).join('')}</div>
            <div class="flex flex-wrap gap-2">
                <input id="busca-estudio" value="${e(this.buscaEstudio)}" oninput="AdminController.filtrarTextoEstudio()" placeholder="Buscar estudio o código" class="border border-slate-300 rounded-lg px-3 py-2 text-sm w-64">
                <button type="button" onclick="AdminController.abrirEditorEstudio()" class="bg-amber-600 hover:bg-amber-700 text-white text-sm font-bold px-4 py-2 rounded-lg">Nuevo estudio / servicio</button>
            </div>
        </div>
        <p class="text-xs text-slate-500 mb-3">Estos códigos también se pueden incluir al armar un paquete quirúrgico en Farmacia.</p>
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-x-auto">
            <table class="w-full text-sm text-left">
                <thead class="bg-slate-50 text-[11px] uppercase text-slate-400"><tr>
                    <th class="px-3 py-3">Código</th><th class="px-3 py-3">Nombre</th><th class="px-3 py-3">Categoría</th><th class="px-3 py-3">Tubo / muestra</th><th class="px-3 py-3">Precio</th><th class="px-3 py-3"></th>
                </tr></thead>
                <tbody id="cuerpo-estudios">${this.htmlFilasEstudios()}</tbody>
            </table>
        </div>`;
    },
    abrirEditorEstudio: function (estudioId) {
        const S = BelenStore, e = t => this.e(t);
        const est = estudioId ? S.listarEstudios().find(x => x.estudio_id === estudioId) : null;
        const cls = 'w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white';
        BelenUI.modal({
            titulo: est ? 'Editar estudio' : 'Nuevo estudio o servicio', icono: 'fa-file-invoice-dollar', ancho: 'md',
            html: `<div class="space-y-3 text-left">
                <label class="block text-[11px] font-bold text-slate-500 uppercase">Código</label>
                <input id="te-codigo" value="${e(est ? est.codigo : '')}" maxlength="20" placeholder="Ej. BH" class="${cls}">
                <label class="block text-[11px] font-bold text-slate-500 uppercase">Nombre</label>
                <input id="te-nombre" value="${e(est ? est.nombre : '')}" maxlength="80" data-autofoco class="${cls}">
                <label class="block text-[11px] font-bold text-slate-500 uppercase">Categoría</label>
                <select id="te-categoria" class="${cls}">${S.TIPOS_ESTUDIO.map(t => `<option value="${t.codigo}" ${est && est.categoria === t.codigo ? 'selected' : ''}>${e(t.nombre)}</option>`).join('')}</select>
                <div id="te-tubo-caja">
                    <label class="block text-[11px] font-bold text-slate-500 uppercase">Tubo / Recipiente / Tipo de Muestra</label>
                    <select id="te-tubo" class="${cls}"></select>
                </div>
                <label class="block text-[11px] font-bold text-slate-500 uppercase">Precio unitario</label>
                <input id="te-precio" type="number" min="0.01" step="0.01" value="${est ? est.precio_unitario : ''}" class="${cls}">
                <label class="flex items-center gap-2 text-sm text-slate-700"><input id="te-iva" type="checkbox" class="rounded border-slate-300 text-amber-600" ${!est || est.aplica_iva ? 'checked' : ''}> Grava 16% solo si en Caja piden factura</label>
                <p id="te-error" class="text-xs text-red-600 hidden"></p>
            </div>`,
            alMostrar: c => {
                const cat = c.el.querySelector('#te-categoria');
                const sel = c.el.querySelector('#te-tubo');
                const caja = c.el.querySelector('#te-tubo-caja');
                const actual = est ? (est.tubo_muestra || '') : 'Tubo Lila (EDTA)';
                const pintarTubo = () => {
                    const pide = cat.value === 'LABORATORIO' || cat.value === 'PATOLOGIA';
                    caja.classList.toggle('hidden', !pide);
                    if (!pide) return;
                    const opciones = S.RECIPIENTES_MUESTRA.slice();
                    if (actual && opciones.indexOf(actual) < 0 && actual !== 'N/A') opciones.push(actual);
                    sel.innerHTML = opciones.map(t => `<option value="${e(t)}" ${t === actual ? 'selected' : ''}>${e(t)}</option>`).join('');
                };
                cat.addEventListener('change', pintarTubo);
                pintarTubo();
            },
            botones: [
                { texto: 'Cancelar', estilo: 'secundario' },
                { texto: 'Guardar', estilo: 'exito', alPulsar: c => {
                    const r = S.guardarEstudio({
                        estudio_id: est ? est.estudio_id : null,
                        codigo: c.el.querySelector('#te-codigo').value,
                        nombre: c.el.querySelector('#te-nombre').value,
                        categoria: c.el.querySelector('#te-categoria').value,
                        tubo_muestra: (c.el.querySelector('#te-categoria').value === 'LABORATORIO' || c.el.querySelector('#te-categoria').value === 'PATOLOGIA') ? c.el.querySelector('#te-tubo').value : 'N/A',
                        precio_unitario: c.el.querySelector('#te-precio').value,
                        aplica_iva: c.el.querySelector('#te-iva').checked
                    }, this.sesion);
                    const error = c.el.querySelector('#te-error');
                    if (!r.ok) { error.textContent = (r.errores && (r.errores.nombre || r.errores.categoria || r.errores.codigo || r.errores.precio_unitario || r.errores.tubo_muestra)) || r.motivo; error.classList.remove('hidden'); return false; }
                    BelenUI.toast(r.estudio.nombre + ' quedó en el tarifario.', 'exito');
                    this.pestanaTarifario = 'catalogo';
                    this.render();
                } }
            ]
        });
    },
    confirmarEliminarEstudio: function (estudioId) {
        const est = BelenStore.listarEstudios().find(x => x.estudio_id === estudioId);
        if (!est) return;
        BelenUI.confirmar({
            titulo: 'Eliminar estudio', tipo: 'peligro', textoConfirmar: 'Eliminar',
            mensaje: 'Se eliminará "' + est.nombre + '" del catálogo. Los cargos ya hechos no se modifican. Un paquete que lo incluya ya no podrá armarse hasta quitar ese código.',
            alConfirmar: () => {
                const r = BelenStore.eliminarEstudio(estudioId, this.sesion);
                if (!r.ok) { BelenUI.toast(r.motivo, 'alerta'); return; }
                BelenUI.toast('Estudio eliminado.', 'info');
                this.render();
            }
        });
    },
    htmlAuditoriaCaja: function () {
        const S = BelenStore, e = t => this.e(t);
        const cuentas = S.cuentasAuditoria(this.sesion);
        if (!cuentas.length) return '<div class="text-center py-16 text-slate-400 bg-white rounded-2xl border border-dashed border-slate-300">No hay cuentas activas ni pendientes de pago.</div>';
        return `<div class="flex flex-col gap-4">${cuentas.map(f => {
            const grupos = [];
            f.lineas.forEach(c => {
                const clave = c.dia + '|' + c.turno_horario + '|' + c.quien;
                let g = grupos.find(x => x.clave === clave);
                if (!g) { g = { clave: clave, dia: c.dia_txt, turno: c.turno_horario, quien: c.quien, lineas: [] }; grupos.push(g); }
                g.lineas.push(c);
            });
            const bloques = grupos.length ? grupos.map(g => `<div class="mt-3">
                <p class="text-[11px] font-extrabold uppercase text-slate-500">${e(g.dia)} · ${e(g.turno)} · ${e(g.quien)}</p>
                <div class="overflow-x-auto"><table class="w-full text-sm mt-1"><tbody>${g.lineas.map(c => `<tr class="border-t border-slate-100">
                    <td class="py-2 pr-3 font-medium text-slate-800">${e(c.concepto)}${c.aplica_iva ? '<span class="block text-[10px] font-bold text-amber-700">Grava IVA</span>' : '<span class="block text-[10px] font-bold text-slate-400">Tasa 0%</span>'}${c.tubo_muestra && c.tubo_muestra !== 'N/A' ? `<span class="block text-[11px] text-violet-700">${e(c.tubo_muestra)}</span>` : ''}${c.observaciones_toma ? `<span class="block text-[11px] text-slate-500">${e(c.observaciones_toma)}</span>` : ''}${c.ajustado_por_nombre ? `<span class="block text-[10px] text-amber-700">Ajustado por ${e(c.ajustado_por_nombre)}</span>` : ''}</td>
                    <td class="py-2 text-right whitespace-nowrap">${e(S.formatoMoneda(c.precio_unitario))}</td>
                    <td class="py-2 text-center">${c.cantidad || 1}</td>
                    <td class="py-2 text-right font-bold whitespace-nowrap">${e(S.formatoMoneda(c.subtotal))}</td>
                    <td class="py-2 text-right"><button type="button" onclick="AdminController.abrirAjusteLinea('${e(f.turno_id)}','${e(c.cargo_id)}')" class="text-xs font-bold text-cyan-800">Ajustar</button></td>
                </tr>`).join('')}</tbody></table></div></div>`).join('') : '<p class="text-sm text-slate-400 mt-3">Sin conceptos cargados.</p>';
            const fiscal = f.fiscal;
            const destacada = this.cuentaDestacada === f.turno_id;
            const corte = (this.rolActual === 'admin' || this.rolActual === 'administrador') && (f.estatus === 'internado' || f.estatus === 'internado_en_proceso')
                ? `<button type="button" onclick="AdminController.abrirCorteEstancia('${e(f.turno_id)}')" class="px-3 py-2 rounded-lg text-xs font-extrabold bg-amber-700 text-white">🛏️ Aplicar Corte de Estancia / Noche</button>` : '';
            return `<article id="cuenta-${e(f.turno_id)}" class="bg-white rounded-2xl border ${destacada ? 'border-amber-500 ring-2 ring-amber-400' : (f.pendiente_pago ? 'border-amber-300' : 'border-slate-200')} shadow-sm p-5">
                <div class="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <div class="flex flex-wrap items-center gap-2"><h3 class="text-lg font-extrabold text-slate-900">${e(f.nombre)}</h3>${this.badgeEstatus({ estatus: f.estatus })}</div>
                        <p class="text-xs text-slate-500 mt-1">${f.origen === 'hospitalizacion' ? 'Hospitalización' : 'Consulta / observación'}${f.cama ? ' · ' + e(f.cama) : ''} · ${e(f.medico_nombre || '')}</p>
                    </div>
                    <div class="text-right">
                        <p class="text-xl font-extrabold text-slate-900">${e(S.formatoMoneda(fiscal.total))}</p>
                        <p class="text-[11px] text-slate-500">${f.requiere_factura ? 'Con factura · IVA ' + e(S.formatoMoneda(fiscal.iva)) : 'Sin IVA'}</p>
                    </div>
                </div>
                ${bloques}
                <div class="mt-4 flex flex-wrap gap-2">
                    <button type="button" role="switch" aria-checked="${f.requiere_factura ? 'true' : 'false'}" onclick="AdminController.alternarFacturaCuenta('${e(f.turno_id)}', ${f.requiere_factura ? 'false' : 'true'})" class="px-3 py-2 rounded-lg text-xs font-extrabold border ${f.requiere_factura ? 'bg-amber-50 border-amber-400 text-amber-900' : 'bg-white border-slate-300 text-slate-700'}">¿Solicita Factura? (+16% IVA): ${f.requiere_factura ? 'encendida' : 'apagada'}</button>
                    ${f.requiere_factura ? `<label class="text-[11px] font-bold text-slate-500 uppercase flex items-center gap-2">Modo de IVA
                        <select onchange="AdminController.cambiarModoIvaCuenta('${e(f.turno_id)}', this.value)" class="normal-case border border-slate-300 rounded-lg px-2 py-2 text-xs font-bold text-slate-800 bg-white">${S.MODOS_IVA.map(m => `<option value="${m.codigo}" ${f.modo_iva === m.codigo ? 'selected' : ''}>${e(m.nombre)}</option>`).join('')}</select>
                    </label>${f.modo_iva === 'manual' ? `<label class="text-[11px] font-bold text-slate-500 uppercase flex items-center gap-2">Base gravable <input type="number" min="0" step="0.01" value="${f.base_gravable_manual != null ? f.base_gravable_manual : ''}" onchange="AdminController.cambiarBaseIvaCuenta('${e(f.turno_id)}', this.value)" class="normal-case w-32 border border-slate-300 rounded-lg px-2 py-2 text-xs font-bold"></label>` : ''}` : ''}
                    <button type="button" onclick="AdminController.imprimirEstadoCuenta('${e(f.turno_id)}')" class="px-3 py-2 rounded-lg text-xs font-extrabold bg-slate-900 text-white">🖨️ Imprimir Estado de Cuenta / Nota de Consumos al Paciente</button>
                    ${corte}
                    ${f.pendiente_pago ? `<button type="button" onclick="AdminController.confirmarCerrarExpediente('${e(f.turno_id)}', ${f.requiere_factura ? 'true' : 'false'})" class="px-3 py-2 rounded-lg text-xs font-extrabold bg-emerald-700 text-white">Marcar como Pagado y Cerrar Expediente</button>` : '<span class="text-xs text-slate-400 px-2 py-2">El cierre de caja se habilita con el alta médica pendiente de pago.</span>'}
                </div>
            </article>`;
        }).join('')}</div>`;
    },
    alternarFacturaCuenta: function (turnoId, encendida) {
        const r = BelenStore.establecerFacturaCuenta(turnoId, encendida === true || encendida === 'true', this.sesion);
        if (!r.ok) { BelenUI.toast(r.motivo, 'alerta'); return; }
        BelenUI.toast(r.requiere_factura ? 'Factura activada. Elija sobre qué monto se aplica el 16%.' : 'Factura apagada. Se cobra sin IVA.', 'info');
        this.render();
    },
    cambiarModoIvaCuenta: function (turnoId, modo) {
        const r = BelenStore.establecerFiscalCuenta(turnoId, { modo_iva: modo }, this.sesion);
        if (!r.ok) { BelenUI.toast(r.motivo, 'alerta'); return; }
        this.render();
    },
    cambiarBaseIvaCuenta: function (turnoId, base) {
        const r = BelenStore.establecerFiscalCuenta(turnoId, { modo_iva: 'manual', base_gravable_manual: base }, this.sesion);
        if (!r.ok) { BelenUI.toast(r.motivo, 'alerta'); return; }
        BelenUI.toast('Base gravable actualizada.', 'info');
        this.render();
    },
    imprimirEstadoCuenta: function (turnoId) {
        const html = BelenStore.htmlEstadoCuenta(turnoId);
        if (!html) { BelenUI.toast('No se encontró la cuenta.', 'alerta'); return; }
        this.imprimirEnDashboard(html);
    },
    abrirAjusteLinea: function (turnoId, cargoId) {
        const S = BelenStore, e = t => this.e(t);
        const f = S.cuentasAuditoria(this.sesion).find(x => x.turno_id === turnoId);
        const c = f && f.lineas.find(x => x.cargo_id === cargoId);
        if (!c) { BelenUI.toast('Ese concepto ya no está en la cuenta.', 'info'); this.render(); return; }
        const cls = 'w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white';
        BelenUI.modal({
            titulo: 'Ajuste manual', subtitulo: c.concepto, icono: 'fa-pen', ancho: 'md',
            html: `<div class="space-y-3 text-left">
                <label class="block text-[11px] font-bold text-slate-500 uppercase">Concepto</label>
                <input id="aj-concepto" value="${e(c.concepto)}" maxlength="80" class="${cls}">
                <div class="grid grid-cols-2 gap-3">
                    <div><label class="block text-[11px] font-bold text-slate-500 uppercase">Precio unitario</label><input id="aj-precio" type="number" step="0.01" value="${c.precio_unitario}" class="${cls}"></div>
                    <div><label class="block text-[11px] font-bold text-slate-500 uppercase">Cantidad</label><input id="aj-cant" type="number" min="1" max="99" step="1" value="${c.cantidad || 1}" class="${cls}"></div>
                </div>
                <label class="flex items-center gap-2 text-sm"><input id="aj-iva" type="checkbox" ${c.aplica_iva ? 'checked' : ''} class="rounded border-slate-300"> Grava 16% si piden factura</label>
                <p id="aj-error" class="text-xs text-red-600 hidden"></p>
            </div>`,
            botones: [
                { texto: 'Cancelar', estilo: 'secundario' },
                { texto: 'Quitar de la cuenta', estilo: 'peligro', alPulsar: ctrl => {
                    const r = S.ajustarLineaCuenta(turnoId, cargoId, { eliminar: true }, this.sesion);
                    if (!r.ok) { BelenUI.toast(r.motivo, 'alerta'); return false; }
                    BelenUI.toast('Concepto retirado de la cuenta.', 'info');
                    this.render();
                } },
                { texto: 'Guardar ajuste', estilo: 'primario', alPulsar: ctrl => {
                    const r = S.ajustarLineaCuenta(turnoId, cargoId, {
                        concepto: ctrl.el.querySelector('#aj-concepto').value,
                        precio_unitario: ctrl.el.querySelector('#aj-precio').value,
                        cantidad: ctrl.el.querySelector('#aj-cant').value,
                        aplica_iva: ctrl.el.querySelector('#aj-iva').checked
                    }, this.sesion);
                    const error = ctrl.el.querySelector('#aj-error');
                    if (!r.ok) { error.textContent = r.motivo; error.classList.remove('hidden'); return false; }
                    BelenUI.toast('Ajuste guardado. Cuenta: ' + S.formatoMoneda(r.total), 'exito');
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
            const busca = S.normalizar([u.nombre, u.id, rol.etiqueta, rol.corta, u.cedula_profesional, u.cedula_general, u.cedula_especialidad, u.cedula_subespecialidad, u.etiqueta_admin, esp].join(' '));
            const btn = (accion, texto, extra) => `<button type="button" onclick="AdminController.${accion}('${e(u.id)}')" class="text-[11px] font-bold px-2 py-1 rounded-md border border-slate-200 hover:border-cyan-400 hover:text-cyan-800 ${extra || ''}">${texto}</button>`;
            return `<tr class="border-t border-slate-100 hover:bg-slate-50/70 ${u.activo === false ? 'opacity-60' : ''}" data-usuario-fila="${e(u.id)}" data-busca="${e(busca)}">
                <td class="px-4 py-3"><div class="flex items-center gap-3">
                    <div class="w-9 h-9 rounded-full ${color} flex items-center justify-center text-xs font-bold shrink-0">${e(S.iniciales(u.nombre.replace(/^(Dra?\.|Enf\.|Adm\.)\s*/, '')))}</div>
                    <div><p class="font-bold text-slate-800 leading-tight">${e(u.nombre)}${u.activo === false ? ' <span class="text-[10px] uppercase text-red-600">Inactivo</span>' : ''}</p>
                        <p class="text-[11px] text-slate-400 font-mono">${e(u.id)}${S.resumenCedulas(u) ? ' · ' + e(S.resumenCedulas(u)) : ''}</p>
                        ${u.etiqueta_admin ? `<p class="text-[11px] text-amber-700">${e(u.etiqueta_admin)}</p>` : ''}</div></div></td>
                <td class="px-4 py-3"><span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded whitespace-nowrap ${color}">${e(rol.corta)}</span><p class="text-xs text-slate-500 mt-1">${e(esp || '')}</p></td>
                ${S.MODULOS.map(m => `<td class="px-4 py-3 text-center">${interruptor(u, m)}</td>`).join('')}
                <td class="px-4 py-3"><div class="flex flex-wrap gap-1 justify-end">
                    ${btn('abrirEditarPersonal', 'Editar')}
                    ${u.rol === 'medico' && (this.rolActual === 'admin' || this.rolActual === 'administrador') ? btn('abrirCostoConsulta', 'Consulta: ' + S.formatoMoneda(u.costo_consulta != null ? u.costo_consulta : (u.especialidad_codigo === 'MEDICINA_GENERAL' ? 400 : 800)), 'text-emerald-700') : ''}
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
                <div><label class="block text-[11px] font-bold text-slate-500 uppercase mb-1" for="rh-pin">Código rápido de farmacia</label><input id="rh-pin" inputmode="numeric" maxlength="8" class="${cls}" value="${u ? e(u.codigo_rapido || '') : ''}" placeholder="4 a 8 dígitos, único"><p data-err="codigo_rapido" class="text-[11px] text-red-600 mt-1 hidden"></p></div>
                <div><label class="block text-[11px] font-bold text-slate-500 uppercase mb-1" for="rh-rol">Perfil</label><select id="rh-rol" class="${cls}" ${u && u.id === 'admin' ? 'disabled' : ''}>${roles}</select><p data-err="rol" class="text-[11px] text-red-600 mt-1 hidden"></p></div>
                <div><label class="block text-[11px] font-bold text-slate-500 uppercase mb-1" for="rh-cargo">Cargo</label><input id="rh-cargo" class="${cls}" value="${u ? e(u.cargo) : ''}"><p data-err="cargo" class="text-[11px] text-red-600 mt-1 hidden"></p></div>
                <div id="rh-cedula-wrap"><label class="block text-[11px] font-bold text-slate-500 uppercase mb-1" for="rh-cedula">Cédula profesional</label><input id="rh-cedula" class="${cls}" value="${u && u.rol !== 'medico' ? e(u.cedula_profesional || '') : ''}"><p data-err="cedula_profesional" class="text-[11px] text-red-600 mt-1 hidden"></p></div>
                <div><label class="block text-[11px] font-bold text-slate-500 uppercase mb-1" for="rh-esp">Especialidad</label><select id="rh-esp" class="${cls}"><option value="">No aplica</option>${esps}</select><p data-err="especialidad_codigo" class="text-[11px] text-red-600 mt-1 hidden"></p></div>
                <div id="rh-cedulas-med" class="hidden sm:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
                    <div class="sm:col-span-2">
                        <label class="block text-[11px] font-bold text-slate-600 uppercase mb-1" for="rh-titulo-impreso">Título / Especialidad impresa en Recetas y Notas</label>
                        <input id="rh-titulo-impreso" class="${cls}" value="${u ? e(u.titulo_impreso || S.especialidadImpresaMedico(u) || '') : ''}" placeholder="Ej. Cirugía General y Laparoscópica · Traumatología y Ortopedia · Angiología">
                        <p class="text-[10px] text-slate-500 mt-0.5">Personalice cómo aparece la especialidad del médico al imprimir (ej. Cirugía General y Laparoscópica, Médico Cirujano y Partero, etc.).</p>
                    </div>
                    <div>
                        <label class="block text-[11px] font-bold text-slate-600 uppercase mb-1" for="rh-universidad">Universidad / Institución (opcional)</label>
                        <input id="rh-universidad" class="${cls}" value="${u ? e(u.universidad_titulo || '') : ''}" placeholder="Ej. UdeG / UNAM">
                    </div>
                    <div><label class="block text-[11px] font-bold text-slate-500 uppercase mb-1" for="rh-ced-general">Cédula Profesional (Licenciatura)</label><input id="rh-ced-general" class="${cls}" value="${u ? e(u.cedula_general || '') : ''}" placeholder="Ej. 12345678"><p data-err="cedula_general" class="text-[11px] text-red-600 mt-1 hidden"></p></div>
                    <div><label class="block text-[11px] font-bold text-slate-500 uppercase mb-1" for="rh-ced-esp">Cédula de Especialidad</label><input id="rh-ced-esp" class="${cls}" value="${u ? e(u.cedula_especialidad || '') : ''}" placeholder="Opcional"><p data-err="cedula_especialidad" class="text-[11px] text-red-600 mt-1 hidden"></p></div>
                    <div><label class="block text-[11px] font-bold text-slate-500 uppercase mb-1" for="rh-ced-sub">Cédula de Subespecialidad</label><input id="rh-ced-sub" class="${cls}" value="${u ? e(u.cedula_subespecialidad || '') : ''}" placeholder="Opcional"><p data-err="cedula_subespecialidad" class="text-[11px] text-red-600 mt-1 hidden"></p></div>
                    <p id="rh-aviso-general" class="hidden sm:col-span-3 text-xs text-cyan-800 bg-cyan-50 border border-cyan-200 rounded-lg px-3 py-2">En los formatos impresos saldrá como <b>Céd. Prof.</b> (y <b>Céd. Esp. / Céd. Subesp.</b> cuando aplique).</p>
                    <div id="rh-visibles" class="sm:col-span-3">
                        <p class="text-[11px] font-bold text-slate-500 uppercase mb-2">Cédulas que se imprimen en notas, indicaciones y recetas</p>
                        <p data-err="cedulas_visibles" class="text-[11px] text-red-600 mt-1 hidden"></p>
                        <div class="flex flex-wrap gap-3 text-sm font-bold text-slate-700">
                            ${['general', 'especialidad', 'subespecialidad'].map(c => `<label class="inline-flex items-center gap-2"><input type="checkbox" data-ced-vis="${c}" ${(!u && c === 'general') || (u && (u.cedulas_visibles || ['general']).indexOf(c) >= 0) ? 'checked' : ''}> ${c === 'general' ? 'Céd. Profesional (Licenciatura)' : (c === 'especialidad' ? 'Céd. Especialidad' : 'Céd. Subespecialidad')}</label>`).join('')}
                        </div>
                    </div>
                </div>
                ${(this.rolActual === 'admin' || this.rolActual === 'administrador') ? `<div id="rh-costo-wrap"><label class="block text-[11px] font-bold text-slate-500 uppercase mb-1" for="rh-costo">Costo de consulta (MXN)</label><input id="rh-costo" type="number" min="0" step="1" class="${cls}" value="${u && u.costo_consulta != null ? e(u.costo_consulta) : ''}" placeholder="400 general · 800 especialista"><p data-err="costo_consulta" class="text-[11px] text-red-600 mt-1 hidden"></p></div>` : ''}
                <div><label class="block text-[11px] font-bold text-slate-500 uppercase mb-1" for="rh-color">Color distintivo</label><select id="rh-color" class="${cls}">${colores}</select></div>
                <div class="sm:col-span-2"><label class="block text-[11px] font-bold text-slate-500 uppercase mb-1" for="rh-etiqueta">Etiqueta informal</label><input id="rh-etiqueta" class="${cls}" maxlength="80" value="${u ? e(u.etiqueta_admin || '') : ''}" placeholder="Nota visible solo para administración"><p data-err="etiqueta_admin" class="text-[11px] text-red-600 mt-1 hidden"></p></div>
            </div>`,
            alMostrar: c => {
                const rol = c.el.querySelector('#rh-rol'), esp = c.el.querySelector('#rh-esp');
                const sync = () => {
                    const medico = rol.value === 'medico';
                    esp.disabled = !medico;
                    if (!medico) esp.value = '';
                    c.el.querySelector('#rh-cedulas-med').classList.toggle('hidden', !medico);
                    c.el.querySelector('#rh-cedula-wrap').classList.toggle('hidden', medico);
                    const costoWrap = c.el.querySelector('#rh-costo-wrap'); if (costoWrap) costoWrap.classList.toggle('hidden', !medico);
                    c.el.querySelector('#rh-visibles').classList.toggle('hidden', !medico);
                    c.el.querySelector('#rh-aviso-general').classList.toggle('hidden', !medico);
                };
                rol.addEventListener('change', sync);
                esp.addEventListener('change', sync);
                sync();
            },
            botones: [
                { texto: 'Cancelar', estilo: 'secundario' },
                { texto: u ? 'Guardar cambios' : 'Crear usuario', estilo: 'primario', alPulsar: c => {
                    const q = sel => c.el.querySelector(sel).value;
                    const rol = c.el.querySelector('#rh-rol').disabled ? 'admin' : q('#rh-rol');
                    const visibles = Array.from(c.el.querySelectorAll('[data-ced-vis]:checked')).map(x => x.getAttribute('data-ced-vis'));
                    const r = S.guardarUsuario({
                        id: q('#rh-id'), nombre: q('#rh-nombre'), password: q('#rh-password'), codigo_rapido: q('#rh-pin'), rol: rol,
                        cargo: q('#rh-cargo'), cedula_profesional: rol === 'medico' ? '' : q('#rh-cedula'),
                        cedula_general: q('#rh-ced-general'), cedula_especialidad: q('#rh-ced-esp'), cedula_subespecialidad: q('#rh-ced-sub'),
                        titulo_impreso: c.el.querySelector('#rh-titulo-impreso') ? q('#rh-titulo-impreso') : '',
                        universidad_titulo: c.el.querySelector('#rh-universidad') ? q('#rh-universidad') : '',
                        cedulas_visibles: visibles, especialidad_codigo: q('#rh-esp'), color_distintivo: q('#rh-color'), etiqueta_admin: q('#rh-etiqueta')
                    }, this.sesion, u ? u.id : null);
                    c.el.querySelectorAll('[data-err]').forEach(p => p.classList.add('hidden'));
                    if (!r.ok) {
                        Object.keys(r.errores || {}).forEach(k => { const p = c.el.querySelector(`[data-err="${k}"]`); if (p) { p.textContent = r.errores[k]; p.classList.remove('hidden'); } });
                        if (!r.errores) BelenUI.toast(r.motivo, 'alerta');
                        return false;
                    }
                    const costoEl = c.el.querySelector('#rh-costo');
                    if (costoEl && rol === 'medico' && String(costoEl.value).trim() !== '' && S.actualizarCostoConsultaMedico) {
                        const idGuardado = (r.usuario && r.usuario.id) || (u ? u.id : q('#rh-id').trim());
                        const rc = S.actualizarCostoConsultaMedico(idGuardado, costoEl.value, this.sesion);
                        if (rc && rc.ok === false) BelenUI.toast('Datos guardados, pero el costo de consulta no: ' + (rc.motivo || ''), 'alerta');
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
        const etiquetas = { capturar_signos: 'Capturar signos', pasar_a_medico: 'Pasar a médico', cargar_consumos: 'Cargar consumos', asignar_cama: 'Asignar cama', programar_cirugia: 'Programar cirugía', gestionar_farmacia: 'Gestionar farmacia', farmacia_paquetes: 'Pestaña Paquetes y Kits', farmacia_estupefacientes: 'Pestaña Estupefacientes Fracción I', ver_bitacora_farmacia: 'Pestaña Bitácora de Entradas y Salidas' };
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
            const edadTxt = S.formatearEdad ? S.formatearEdad(p.fecha_nacimiento) : (S.calcularEdad(p.fecha_nacimiento) !== null ? S.calcularEdad(p.fecha_nacimiento) + ' años' : '—');
            const ultima = v[0] && v[0].consulta && v[0].consulta.fecha_hora ? S.fechaLegibleISO(v[0].consulta.fecha_hora.slice(0, 10)) : '—';
            const turnos = S.listarTurnos().filter(t => t.paciente_id === p.paciente_id)
                .sort((a, b) => String(b.actualizado_en || b.timestamp_llegada || '').localeCompare(String(a.actualizado_en || a.timestamp_llegada || '')));
            const ultimo = turnos[0];
            const archivoHosp = turnos.find(t => (t.estatus === 'cerrado_historico' || t.estatus === 'alta_medica_pendiente_pago') && S.internamientoDeTurno(t.turno_id));
            const badge = ultimo ? this.badgeEstatus(ultimo) : '<span class="text-slate-400">—</span>';
            const portafolio = archivoHosp
                ? `<a href="expediente.html?modo=hospitalizado&turno=${encodeURIComponent(archivoHosp.turno_id)}" class="text-xs font-bold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg px-3 py-1.5 transition inline-flex items-center gap-1"><i class="fas fa-folder-tree"></i> Portafolio</a>`
                : '';
            const nRecetas = S.recetasDePaciente(p.paciente_id).length;
            const recetas = nRecetas
                ? `<button type="button" onclick="AdminController.abrirRecetasPaciente('${this.e(p.paciente_id)}')" class="text-xs font-bold text-rose-800 hover:text-rose-950 bg-rose-50 hover:bg-rose-100 rounded-lg px-3 py-1.5 transition">Recetas (${nRecetas})</button>`
                : '';
            const buscar = S.normalizar([p.nombre_completo, p.paciente_id, ultimo && ultimo.dx_principal, ultimo && ultimo.medico_nombre, ultimo && ultimo.estatus, archivoHosp ? 'cerrado historico portafolio' : ''].filter(Boolean).join(' '));
            return `<tr class="border-t border-slate-100 hover:bg-slate-50" data-paciente="${this.e(p.paciente_id)}" data-buscar="${this.e(buscar)}">
                <td class="px-4 py-3 font-bold text-slate-800">${this.e(p.nombre_completo)}<span class="block text-[11px] font-normal text-slate-400">${this.e(p.paciente_id)}</span></td>
                <td class="px-4 py-3 text-slate-600">${this.e(edadTxt || '—')} · ${p.sexo === 'F' ? 'Femenino' : 'Masculino'}${p.nacionalidad && p.nacionalidad !== 'Mexicana' ? ' · <span class="text-xs font-semibold text-cyan-700">🌍 ' + this.e(p.nacionalidad) + '</span>' : ''}</td>
                <td class="px-4 py-3 text-slate-600">${badge || '<span class="text-slate-400">—</span>'}</td>
                <td class="px-4 py-3 text-slate-600 text-center">${v.length}</td>
                <td class="px-4 py-3 text-slate-600">${ultima}</td>
                <td class="px-4 py-3 text-right whitespace-nowrap"><div class="inline-flex flex-wrap justify-end gap-2">${portafolio}${recetas}<button type="button" data-accion="ver-visitas" onclick="AdminController.verVisitasPaciente('${this.e(p.paciente_id)}')" class="text-xs font-bold text-cyan-700 hover:text-cyan-900 bg-cyan-50 hover:bg-cyan-100 rounded-lg px-3 py-1.5 transition" ${v.length ? '' : 'disabled style="opacity:.4;cursor:not-allowed"'}>Ver visitas</button></div></td></tr>`;
        }).join('');
        const fusion = (this.rolActual === 'admin' || this.rolActual === 'administrador')
            ? `<button type="button" onclick="AdminController.abrirFusionExpedientes()" class="bg-white border border-violet-300 text-violet-800 hover:bg-violet-50 text-sm font-extrabold px-4 py-2.5 rounded-xl">🔗 Fusionar Expedientes Duplicados</button>`
            : '';
        return `<div class="mb-6 flex flex-wrap items-end justify-between gap-3"><div><h2 class="text-2xl font-extrabold text-slate-800">Búsqueda Histórica</h2>
                    <p class="text-slate-500">${this.rolActual === 'medico' ? 'Archivo de los pacientes que usted ha atendido. Los expedientes cerrados ya no aparecen en los monitores activos.' : 'Archivo longitudinal. Un expediente cerrado sale de camas, fila y caja, y se consulta solo aquí.'}</p></div>${fusion}</div>
                <div class="mb-4 relative max-w-xl">
                    <i class="fas fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
                    <input id="busqueda-historica" type="search" autocomplete="off" placeholder="Buscar por nombre, expediente o diagnóstico" oninput="AdminController.filtrarHistorico(this.value)"
                        class="w-full border border-slate-300 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-800 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none bg-white">
                </div>
                <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-x-auto"><table class="w-full text-sm text-left min-w-[640px]" id="tabla-historico">
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

    llenarIdentidad: function (raiz, prefijo, paciente) {
        const partes = BelenStore.partesDeNombre(paciente);
        const set = (id, val) => { const n = raiz.querySelector('#' + prefijo + '-' + id); if (n && val !== undefined && val !== null) n.value = val; };
        set('nombres', partes.nombres);
        set('paterno', partes.apellido_paterno);
        set('materno', partes.apellido_materno);
        set('fn', paciente.fecha_nacimiento || '');
        set('sexo', paciente.sexo || '');
        set('tel', paciente.telefono || '');
        set('dir', paciente.direccion || '');
        set('nac', paciente.nacionalidad || 'Mexicana');
        const badge = raiz.querySelector('#' + prefijo + '-edad-badge');
        if (badge && paciente.fecha_nacimiento && BelenStore.formatearEdad) {
            const edTxt = BelenStore.formatearEdad(paciente.fecha_nacimiento);
            if (edTxt) { badge.textContent = edTxt; badge.classList.remove('hidden'); }
        }
    },

    abrirFusionExpedientes: function () {
        if (this.rolActual !== 'admin' && this.rolActual !== 'administrador') { BelenUI.toast('Solo administración puede fusionar expedientes.', 'alerta'); return; }
        const S = BelenStore, self = this;
        const cls = 'w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none bg-white';
        BelenUI.modal({
            titulo: 'Fusionar expedientes duplicados',
            subtitulo: 'El expediente que se absorbe desaparece. Sus visitas, turnos, cirugías y recetas pasan al que se conserva.',
            icono: 'fa-link', ancho: 'lg',
            html: `<div class="space-y-4 text-left">
                <div><label class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Expediente que se conserva</label>
                    <input id="fusion-busca-destino" class="${cls}" placeholder="Nombre, en cualquier orden" autocomplete="off">
                    <div id="fusion-lista-destino" class="mt-1 flex flex-col gap-1"></div>
                    <p id="fusion-destino" class="text-xs font-bold text-emerald-800 mt-1"></p></div>
                <div><label class="block text-[11px] font-bold text-slate-500 uppercase mb-1">Expediente duplicado que se absorbe</label>
                    <input id="fusion-busca-origen" class="${cls}" placeholder="Nombre del duplicado" autocomplete="off">
                    <div id="fusion-lista-origen" class="mt-1 flex flex-col gap-1"></div>
                    <p id="fusion-origen" class="text-xs font-bold text-rose-800 mt-1"></p></div>
                <p id="fusion-error" class="text-xs text-red-600 hidden"></p>
            </div>`,
            alMostrar: c => {
                c.destinoId = '';
                c.origenId = '';
                const enlazar = (entradaId, listaId, etiquetaId, clave) => {
                    const input = c.el.querySelector(entradaId);
                    input.addEventListener('input', () => {
                        const caja = c.el.querySelector(listaId);
                        const lista = S.buscarPacientesPorNombre(input.value, 6);
                        caja.innerHTML = lista.map(p => `<button type="button" data-pac="${self.e(p.paciente_id)}" class="text-left text-xs bg-white border border-slate-200 rounded-lg px-3 py-2 hover:border-violet-400"><b>${self.e(p.nombre_completo)}</b><span class="block text-slate-400">${self.e(p.paciente_id)} · ${self.e(S.fechaLegibleISO(p.fecha_nacimiento))}</span></button>`).join('');
                        caja.querySelectorAll('[data-pac]').forEach(b => b.addEventListener('click', () => {
                            const p = S.buscarPacientePorId(b.getAttribute('data-pac'));
                            if (!p) return;
                            c[clave] = p.paciente_id;
                            input.value = p.nombre_completo;
                            caja.innerHTML = '';
                            c.el.querySelector(etiquetaId).textContent = p.paciente_id + ' · ' + p.nombre_completo;
                        }));
                    });
                };
                enlazar('#fusion-busca-destino', '#fusion-lista-destino', '#fusion-destino', 'destinoId');
                enlazar('#fusion-busca-origen', '#fusion-lista-origen', '#fusion-origen', 'origenId');
            },
            botones: [
                { texto: 'Cancelar', estilo: 'secundario' },
                { texto: 'Fusionar en un solo expediente', estilo: 'primario', alPulsar: c => {
                    const error = c.el.querySelector('#fusion-error');
                    const r = S.fusionarExpedientes(c.destinoId, c.origenId, this.sesion);
                    if (!r.ok) { error.textContent = r.motivo; error.classList.remove('hidden'); return false; }
                    BelenUI.toast(r.absorbido + ' quedó unido a ' + r.paciente.nombre_completo + '.', 'exito');
                    this.render();
                } }
            ]
        });
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
        const optsEsp = S.ESPECIALIDADES.filter(x => !esMedico || x.codigo === s.especialidad_codigo)
            .map(x => `<option value="${x.codigo}">${this.e(x.nombre)}</option>`).join('');
        const cls = 'w-full border border-slate-300 rounded-lg p-2.5 text-sm text-slate-800 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none bg-white';
        const campoErr = k => `<p data-err="${k}" class="text-[11px] text-red-600 mt-1 hidden"></p>`;
        const html = `
            <div class="mb-4 bg-cyan-50/90 border-2 border-cyan-200 rounded-xl p-3.5">
                <div class="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                    <label for="reg-busqueda-rapida" class="text-xs font-extrabold text-cyan-950 flex items-center gap-1.5">
                        <i class="fas fa-magnifying-glass text-cyan-700"></i> ¿Ya tiene expediente en Sanatorio Belén? Buscador rápido de pacientes:
                    </label>
                    <span class="text-[10px] font-bold text-cyan-700 bg-white border border-cyan-200 rounded-full px-2.5 py-0.5">Busca por nombre, apellidos, folio PAC-… o teléfono</span>
                </div>
                <div class="relative">
                    <input id="reg-busqueda-rapida" type="search" autocomplete="off" placeholder="Escriba nombre, apellidos, teléfono o folio PAC-000001 para encontrar su expediente al instante…"
                        class="w-full border border-cyan-300 rounded-lg px-3 py-2 text-sm text-slate-800 bg-white focus:border-cyan-600 focus:ring-2 focus:ring-cyan-200 outline-none">
                </div>
                <div id="reg-resultados-rapidos" class="mt-2 flex flex-col gap-1.5 empty:hidden max-h-56 overflow-y-auto"></div>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-6 gap-4">
                ${BelenUI.htmlIdentidadPaciente({ prefijo: 'reg', cls: cls, sugerencias: true, autofoco: true })}
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
        const fn = q('#reg-fn'), sexo = q('#reg-sexo'), esp = q('#reg-especialidad'), med = q('#reg-medico');
        c.coincidencia = null;
        const identidad = () => BelenUI.leerIdentidadPaciente(c.el, 'reg');

        const llenarMedicos = () => {
            const lista = esp.value ? S.medicosDeEspecialidad(esp.value) : [];
            med.innerHTML = (lista.length === 1 ? '' : `<option value="">${esp.value ? 'Seleccione…' : 'Seleccione una especialidad…'}</option>`) +
                lista.map(m => `<option value="${m.medico_id}">${this.e(m.nombre)}</option>`).join('');
        };
        const mostrarEstado = (html) => { const b = q('#reg-estado'); b.innerHTML = html || ''; b.classList.toggle('hidden', !html); };

        const evaluar = () => {
            const idn = identidad();
            const n = idn.nombre_completo;
            const m = S.buscarPacientePorIdentidad(n, fn.value);
            c.coincidencia = m;
            if (m) {
                const visitas = S.visitasDePaciente(m.paciente_id).length;
                const edTxt = S.formatearEdad ? S.formatearEdad(m.fecha_nacimiento) : '';
                mostrarEstado(`<div id="reg-badge-encontrado" class="flex flex-wrap items-center justify-between gap-3 bg-emerald-50 border border-emerald-300 rounded-lg px-4 py-3">
                    <div class="flex items-center gap-3">
                        <i class="fas fa-folder-open text-emerald-600 text-xl"></i>
                        <div><p class="text-sm font-bold text-emerald-800">Expediente Encontrado y Seleccionado</p>
                        <p class="text-xs text-emerald-700">Se reutiliza <b>${this.e(m.nombre_completo)}</b> · <span class="font-mono font-bold">${this.e(m.paciente_id)}</span>${edTxt ? ' · ' + this.e(edTxt) : ''} · Tel: ${this.e(m.telefono || 'Sin tel.')} · ${visitas} ${visitas === 1 ? 'visita previa' : 'visitas previas'}</p></div>
                    </div>
                    <button type="button" id="reg-btn-ver-seleccionado" class="text-xs font-extrabold bg-white hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-lg px-3 py-1.5 transition">🔍 Ver datos del expediente</button>
                </div>`);
                const btnVer = q('#reg-btn-ver-seleccionado');
                if (btnVer && BelenUI.modalVerificarExpediente) {
                    btnVer.addEventListener('click', () => BelenUI.modalVerificarExpediente(m.paciente_id));
                }
            } else {
                sexo.disabled = false;
                if (n.split(' ').filter(Boolean).length >= 2 && fn.value) {
                    const homo = S.homonimos(n, fn.value);
                    mostrarEstado(homo.length
                        ? `<div class="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-800"><i class="fas fa-triangle-exclamation mt-0.5"></i><p>Existe un paciente con los mismos nombres pero otra fecha de nacimiento (${this.e(S.fechaLegibleISO(homo[0].fecha_nacimiento))}). Se creará un expediente nuevo.</p></div>`
                        : `<div class="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-xs text-slate-600"><i class="fas fa-user-plus text-slate-400"></i><p>Paciente nuevo: se creará un expediente al confirmar.</p></div>`);
                } else mostrarEstado('');
            }
        };

        const renderTarjetaCoincidencia = (p) => {
            const edTxt = S.formatearEdad ? S.formatearEdad(p.fecha_nacimiento) : '';
            const vis = S.visitasDePaciente(p.paciente_id).length;
            return `<div class="flex flex-wrap items-center justify-between gap-2 bg-white border border-slate-200 hover:border-cyan-400 rounded-lg px-3 py-2 shadow-2xs">
                <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-1.5">
                        <span class="font-mono text-[10px] font-extrabold bg-cyan-100 text-cyan-900 px-1.5 py-0.5 rounded">${this.e(p.paciente_id)}</span>
                        <b class="text-xs text-slate-900">${this.e(p.nombre_completo)}</b>
                        <span class="text-[11px] font-bold text-cyan-800">${this.e(edTxt)}</span>
                        <span class="text-[10px] text-slate-500">· Nac: ${this.e(S.fechaLegibleISO(p.fecha_nacimiento))}</span>
                    </div>
                    <p class="text-[11px] text-slate-500 truncate mt-0.5">
                        <i class="fas fa-phone text-[9px] mr-1"></i>${this.e(p.telefono || 'Sin teléfono')}
                        · <i class="fas fa-location-dot text-[9px] mr-1"></i>${this.e(p.direccion || 'Sin domicilio')}
                        · ${vis} ${vis === 1 ? 'visita' : 'visitas'}
                    </p>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                    <button type="button" tabindex="-1" data-ver-exp="${this.e(p.paciente_id)}" class="text-[11px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-md px-2.5 py-1 transition" title="Ver fecha de nacimiento, teléfono, domicilio y visitas para confirmar identidad">🔍 Revisar expediente</button>
                    <button type="button" tabindex="-1" data-usar-exp="${this.e(p.paciente_id)}" class="text-[11px] font-extrabold bg-cyan-700 hover:bg-cyan-800 text-white rounded-md px-2.5 py-1 transition">Usar expediente existente</button>
                </div>
            </div>`;
        };

        const enlazarBotonesCoincidencia = (contenedor, alSeleccionar) => {
            contenedor.querySelectorAll('[data-usar-exp]').forEach(b => b.addEventListener('click', ev => {
                ev.preventDefault();
                const p = S.buscarPacientePorId(b.getAttribute('data-usar-exp'));
                if (!p) return;
                alSeleccionar(p);
            }));
            contenedor.querySelectorAll('[data-ver-exp]').forEach(b => b.addEventListener('click', ev => {
                ev.preventDefault();
                const pid = b.getAttribute('data-ver-exp');
                if (BelenUI.modalVerificarExpediente) {
                    BelenUI.modalVerificarExpediente(pid, p => alSeleccionar(p));
                }
            }));
        };

        const aplicarPacienteExistente = (p) => {
            this.llenarIdentidad(c.el, 'reg', p);
            if (p.sexo) sexo.value = p.sexo;
            const caja = q('#sugerencias-homonimos-discretas'); if (caja) caja.innerHTML = '';
            const resRap = q('#reg-resultados-rapidos'); if (resRap) resRap.innerHTML = '';
            const busqRap = q('#reg-busqueda-rapida'); if (busqRap) busqRap.value = '';
            evaluar();
        };

        const sugerencias = () => {
            let caja = q('#sugerencias-homonimos-discretas');
            if (!caja) {
                const ancla = q('#reg-materno') || q('#reg-paterno') || q('#reg-nombres');
                if (!ancla) return;
                caja = document.createElement('div');
                caja.id = 'sugerencias-homonimos-discretas';
                caja.className = 'mt-1.5 flex flex-col gap-1.5 text-xs sm:col-span-6';
                const grid = ancla.closest('.grid') || ancla.parentNode;
                const ref = q('#reg-estado');
                if (grid && ref) grid.insertBefore(caja, ref);
                else (ancla.closest('div') || ancla.parentNode).appendChild(caja);
                const vieja = q('#reg-sugerencias'); if (vieja) vieja.innerHTML = '';
            }
            const idn = identidad();
            if (c.coincidencia || idn.nombre_completo.length < 3) { caja.innerHTML = ''; return; }
            const res = (S.buscarPacientes ? S.buscarPacientes(idn.nombre_completo, 5) : S.buscarPacientesPorNombre(idn.nombre_completo, 5)) || [];
            caja.innerHTML = res.length ? '<p class="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1"><i class="fas fa-user-check mr-1"></i>Coincidencias en archivo: verifique fecha de nacimiento, teléfono o domicilio antes de usar el expediente:</p>' + res.map(renderTarjetaCoincidencia).join('') : '';
            enlazarBotonesCoincidencia(caja, aplicarPacienteExistente);
        };

        const busqRapida = q('#reg-busqueda-rapida'), resRapidos = q('#reg-resultados-rapidos');
        if (busqRapida && resRapidos) {
            busqRapida.addEventListener('input', () => {
                const txt = busqRapida.value.trim();
                if (txt.length < 2) { resRapidos.innerHTML = ''; return; }
                const n = S.normalizar(txt);
                const todos = S.listarPacientes();
                const lista = todos.filter(p => {
                    const campos = S.normalizar([p.nombre_completo, p.paciente_id, p.telefono, p.direccion, p.fecha_nacimiento].join(' '));
                    return campos.indexOf(n) >= 0;
                }).slice(0, 6);
                resRapidos.innerHTML = lista.length
                    ? lista.map(renderTarjetaCoincidencia).join('')
                    : '<p class="text-xs text-slate-500 bg-white border border-slate-200 rounded-lg px-3 py-2">No se encontró ningún expediente con ese dato. Llene los campos de abajo para crear un expediente nuevo.</p>';
                enlazarBotonesCoincidencia(resRapidos, aplicarPacienteExistente);
            });
        }

        ['reg-nombres', 'reg-paterno', 'reg-materno'].forEach(id => q('#' + id).addEventListener('input', () => { evaluar(); sugerencias(); }));
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
        const idn = BelenUI.leerIdentidadPaciente(c.el, 'reg');
        const v = {
            nombres: idn.nombres, paterno: idn.apellido_paterno, materno: idn.apellido_materno, nombre: idn.nombre_completo,
            fn: idn.fecha_nacimiento, sexo: idn.sexo, tel: idn.telefono, dir: idn.direccion, nacionalidad: idn.nacionalidad || 'Mexicana',
            especialidad: q('#reg-especialidad').value, medico: q('#reg-medico').value, motivo: S.limpiarEspacios(q('#reg-motivo').value)
        };
        const letra = t => /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'.\- ]{2,}$/.test(t);
        const errores = {};
        if (!letra(v.nombres)) errores.nombres = 'Escriba el nombre (solo letras).';
        if (!letra(v.paterno)) errores.paterno = 'Escriba el apellido paterno (solo letras).';
        if (v.materno && !letra(v.materno)) errores.materno = 'El apellido materno solo admite letras.';
        if (!errores.nombres && !errores.paterno && v.nombre.split(' ').filter(w => w.length > 1).length < 2) errores.nombres = 'Escriba nombre y apellido del paciente.';
        if (v.tel.length !== 10) errores.tel = 'Escriba 10 dígitos de teléfono o celular.';
        if (v.dir.length < 8 || v.dir.length > 150) errores.dir = 'Escriba calle, número y colonia (mínimo 8 caracteres).';
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
        const edadTxt = S.formatearEdad ? S.formatearEdad(v.fn) : (S.calcularEdad(v.fn) !== null ? S.calcularEdad(v.fn) + ' años' : '');
        BelenUI.modal({
            titulo: 'Confirme los datos del paciente', subtitulo: 'Revise antes de registrar', tipo: 'info', icono: 'fa-clipboard-check', ancho: 'md',
            html: `<div class="text-sm text-left" id="reg-resumen">
                ${fila('Paciente', this.e(existente ? existente.nombre_completo : v.nombre))}
                ${fila('Nacionalidad', this.e(v.nacionalidad || 'Mexicana'))}
                ${fila('Teléfono', this.e(v.tel))}
                ${fila('Dirección', this.e(v.dir))}
                ${fila('Expediente', existente ? `<span class="text-emerald-700">Existente · ${this.e(existente.paciente_id)}</span>` : '<span class="text-slate-600">Nuevo (se creará)</span>')}
                ${fila('Nacimiento y Edad', this.e(S.fechaLegibleISO(v.fn)) + (edadTxt ? ` (${this.e(edadTxt)})` : ''))}
                ${fila('Sexo', v.sexo === 'F' ? 'Femenino' : 'Masculino')}
                ${fila('Especialidad', this.e(esp.nombre))}
                ${fila('Médico', this.e(medico.nombre))}
                ${fila('Motivo', this.e(v.motivo))}
                <div class="mt-3 bg-slate-900 text-white rounded-lg px-4 py-3 flex items-center justify-between"><span class="text-xs uppercase text-slate-300 font-bold">Posición en la fila</span><span class="text-lg font-extrabold">${this.e(esp.nombre)} · Turno ${numero}</span></div></div>`,
            botones: [
                { texto: 'Regresar y editar', estilo: 'secundario' },
                { texto: 'Confirmar y Registrar', estilo: 'exito', id: 'reg-confirmar', alPulsar: () => {
                    const pac = S.guardarPaciente(existente ? {
                        paciente_id: existente.paciente_id, nombre_completo: existente.nombre_completo, fecha_nacimiento: existente.fecha_nacimiento,
                        sexo: v.sexo || existente.sexo, telefono: v.tel, direccion: v.dir, nacionalidad: v.nacionalidad || existente.nacionalidad || 'Mexicana'
                    } : {
                        nombres: v.nombres, apellido_paterno: v.paterno, apellido_materno: v.materno,
                        nombre_completo: v.nombre, fecha_nacimiento: v.fn, sexo: v.sexo, telefono: v.tel, direccion: v.dir, nacionalidad: v.nacionalidad || 'Mexicana'
                    });
                    if (!pac) { BelenUI.toast('No fue posible guardar al paciente.', 'peligro'); return false; }
                    const dupTurno = S.turnoActivoEnEspecialidad ? S.turnoActivoEnEspecialidad(pac.paciente_id, v.especialidad, v.medico) : null;
                    if (dupTurno) { BelenUI.toast('El paciente ya tiene un turno activo en esta especialidad con este médico (' + (dupTurno.especialidad || '') + ' · ' + (dupTurno.medico_nombre || '') + ').', 'peligro', 6000); return false; }
                    const regTurno = S.registrarTurno ? S.registrarTurno({ paciente_id: pac.paciente_id, especialidad_codigo: v.especialidad, medico_id: v.medico, motivo: v.motivo, registrado_por: this.sesion.nombre }, this.sesion) : null;
                    const turno = regTurno ? (regTurno.ok ? regTurno.turno : null) : S.crearTurno({ paciente_id: pac.paciente_id, especialidad_codigo: v.especialidad, medico_id: v.medico, motivo: v.motivo, registrado_por: this.sesion.nombre });
                    if (!turno) { BelenUI.toast((regTurno && regTurno.motivo) || 'No fue posible registrar al paciente: revise especialidad y médico.', 'peligro', 6000); return false; }
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
