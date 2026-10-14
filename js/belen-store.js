// Archivo: js/belen-store.js
// ============================================================
// CAPA DE DATOS COMPARTIDA DE BELÉN OS (simulación del backend)
// ------------------------------------------------------------
// Todo vive en localStorage (compartido entre pestañas) salvo la SESIÓN, que
// vive en sessionStorage (una sesión por pestaña, así se puede probar enfermería
// y médico a la vez). Cada colección tiene la forma de una tabla SQL futura:
//
//   belen_catalogo_pacientes ... pacientes (paciente_id PK)
//   belen_turnos ............... fila de espera / episodios (turno_id PK, FK paciente_id, medico_id)
//   belen_visitas .............. expedientes finalizados completos (visita_id PK, FK paciente_id, turno_id)
//   belen_borradores ........... { [turno_id]: borrador del expediente en curso }
//   belen_pacientes_hospitalizados ... arreglo de expedientes de pacientes internados
// ============================================================
(function (global) {
    'use strict';

    const CLAVES = {
        catalogo: 'belen_catalogo_pacientes',
        turnos: 'belen_turnos',
        visitas: 'belen_visitas',
        borradores: 'belen_borradores',
        hospitalizados: 'belen_pacientes_hospitalizados',
        demo: 'belen_demo_sembrado'
    };

    // ---------------------------------------------------------------- Catálogos
    const ESPECIALIDADES = [
        { codigo: 'MEDICINA_GENERAL', nombre: 'Medicina General' },
        { codigo: 'ANGIOLOGIA', nombre: 'Angiología' },
        { codigo: 'CIRUGIA_GENERAL', nombre: 'Cirugía General' },
        { codigo: 'MEDICINA_INTERNA', nombre: 'Medicina Interna' }
    ];

    // rol: admin | enfermeria | medico   (los 4 médicos comparten el rol 'medico' y se distinguen por medico_id)
    const USUARIOS = {
        admin:         { id: 'admin',         rol: 'admin',      nombre: 'Alfonso',               cargo: 'Dirección General' },
        enfermeria:    { id: 'enfermeria',    rol: 'enfermeria', nombre: 'Enf. Lupita',           cargo: 'Jefa de Enfermería' },
        dr_juan:       { id: 'dr_juan',       rol: 'medico',     nombre: 'Dr. Juan Pérez',        cargo: 'Medicina General', medico_id: 'dr_juan',       especialidad_codigo: 'MEDICINA_GENERAL' },
        dr_roberto:    { id: 'dr_roberto',    rol: 'medico',     nombre: 'Dr. Roberto Flores',    cargo: 'Angiología',       medico_id: 'dr_roberto',    especialidad_codigo: 'ANGIOLOGIA' },
        dr_arturo:     { id: 'dr_arturo',     rol: 'medico',     nombre: 'Dr. Arturo Gómez',      cargo: 'Cirugía General',  medico_id: 'dr_arturo',     especialidad_codigo: 'CIRUGIA_GENERAL' },
        dr_internista: { id: 'dr_internista', rol: 'medico',     nombre: 'Dr. Carlos Méndez',     cargo: 'Medicina Interna', medico_id: 'dr_internista', especialidad_codigo: 'MEDICINA_INTERNA' }
    };
    // Alias de la versión anterior del demo
    const ALIAS_USUARIO = { doctor: 'dr_juan', medico: 'dr_juan', enfermera: 'enfermeria' };

    // Matriz de permisos por rol (una sola fuente de verdad para toda la aplicación)
    const PERMISOS = {
        ver_dashboard_admin:       ['admin'],
        registrar_paciente:        ['admin'],
        registrar_consulta_directa:['medico'],   // el médico solo puede registrarse pacientes a sí mismo
        ver_fila_completa:         ['admin', 'enfermeria'],
        capturar_signos:           ['admin', 'enfermeria', 'medico'],
        pasar_a_medico:            ['admin', 'enfermeria'],
        iniciar_consulta:          ['admin', 'medico'],
        editar_nota_medica:        ['admin', 'medico'],
        editar_indicaciones:       ['admin', 'medico'],
        editar_hoja_frontal:       ['admin', 'enfermeria', 'medico'],
        editar_consentimientos:    ['admin', 'enfermeria', 'medico'],
        finalizar_expediente:      ['admin', 'medico'],
        ver_historial_visitas:     ['admin', 'medico'],
        ver_hospitalizados:        ['admin', 'enfermeria', 'medico'],
        ver_expedientes_catalogo:  ['admin', 'medico']
    };

    const ESTATUS = {
        PENDIENTE_SIGNOS: 'pendiente_signos',
        SIGNOS_CAPTURADOS: 'signos_capturados',
        EN_CONSULTA: 'en_consulta',
        INTERNADO_EN_PROCESO: 'internado_en_proceso',
        INTERNADO: 'internado',
        ALTA: 'alta'
    };
    const ETIQUETA_ESTATUS = {
        pendiente_signos: 'Pendiente de signos vitales',
        signos_capturados: 'Signos capturados',
        en_consulta: 'En consulta',
        internado_en_proceso: 'Internamiento en proceso',
        internado: 'Internado',
        alta: 'Alta'
    };
    const ESTATUS_EN_FILA = ['pendiente_signos', 'signos_capturados', 'en_consulta'];

    // ---------------------------------------------------------------- Utilidades
    function leer(clave, porDefecto) {
        try {
            const v = JSON.parse(localStorage.getItem(clave));
            return (v === null || v === undefined) ? porDefecto : v;
        } catch (e) { return porDefecto; }
    }
    function escribir(clave, valor) {
        try { localStorage.setItem(clave, JSON.stringify(valor)); return true; } catch (e) { return false; }
    }
    function normalizar(t) {
        return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    }
    function limpiarEspacios(t) { return String(t || '').trim().replace(/\s+/g, ' '); }
    function uid(prefijo) { return prefijo + '-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase(); }
    function hoyLocal() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function parseFechaISO(fn) {
        const m = String(fn || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return null;
        const d = new Date(+m[1], +m[2] - 1, +m[3]);
        return (d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3]) ? d : null;
    }
    function calcularEdad(fn, ref) {
        const nac = parseFechaISO(fn);
        if (!nac) return null;
        const r = ref || new Date();
        let edad = r.getFullYear() - nac.getFullYear();
        const m = r.getMonth() - nac.getMonth();
        if (m < 0 || (m === 0 && r.getDate() < nac.getDate())) edad--;
        return edad < 0 ? null : edad;
    }
    function fechaLegibleISO(fn) {
        const m = String(fn || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? `${m[3]}/${m[2]}/${m[1]}` : (fn || '');
    }
    function iniciales(nombre) {
        const p = limpiarEspacios(nombre).split(' ').filter(w => w.length > 2 || /^[A-ZÁÉÍÓÚÑ]/.test(w));
        return (p.slice(0, 3).map(w => w[0]).join('') || '?').toUpperCase();
    }
    // 00:12:05 / 12:05 (reloj de espera)
    function formatoReloj(ms) {
        const s = Math.max(0, Math.floor(ms / 1000));
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), seg = s % 60;
        const dos = n => String(n).padStart(2, '0');
        return h > 0 ? `${h}:${dos(m)}:${dos(seg)}` : `${dos(m)}:${dos(seg)}`;
    }

    // ---------------------------------------------------------------- Sesión
    function ss(k) { return sessionStorage.getItem(k); }

    function iniciarSesion(idEntrada) {
        const id = normalizar(idEntrada);
        const u = USUARIOS[ALIAS_USUARIO[id] || id];
        if (!u) return null;
        ['belen_rol_usuario', 'belen_usuario_id', 'belen_usuario_nombre', 'belen_usuario_cargo', 'belen_medico_id', 'belen_medico_nombre', 'belen_especialidad', 'belen_especialidad_codigo']
            .forEach(k => sessionStorage.removeItem(k));
        sessionStorage.setItem('belen_rol_usuario', u.rol);
        sessionStorage.setItem('belen_usuario_id', u.id);
        sessionStorage.setItem('belen_usuario_nombre', u.nombre);
        sessionStorage.setItem('belen_usuario_cargo', u.cargo);
        if (u.rol === 'medico') {
            const esp = ESPECIALIDADES.find(e => e.codigo === u.especialidad_codigo);
            sessionStorage.setItem('belen_medico_id', u.medico_id);
            sessionStorage.setItem('belen_medico_nombre', u.nombre);
            sessionStorage.setItem('belen_especialidad', esp ? esp.nombre : u.cargo);
            sessionStorage.setItem('belen_especialidad_codigo', u.especialidad_codigo);
        }
        return u;
    }

    // Devuelve la sesión vigente o null (una sesión de médico sin medico_id se considera inválida)
    function sesion() {
        const rol = ss('belen_rol_usuario');
        if (!rol) return null;
        const s = {
            rol: rol,
            usuario_id: ss('belen_usuario_id'),
            nombre: ss('belen_usuario_nombre'),
            cargo: ss('belen_usuario_cargo'),
            medico_id: ss('belen_medico_id') || null,
            medico_nombre: ss('belen_medico_nombre') || null,
            especialidad: ss('belen_especialidad') || null,
            especialidad_codigo: ss('belen_especialidad_codigo') || null
        };
        if (!s.usuario_id || !USUARIOS[s.usuario_id]) return null;
        if (rol === 'medico' && !s.medico_id) return null;
        return s;
    }

    function cerrarSesion() {
        ['belen_rol_usuario', 'belen_usuario_id', 'belen_usuario_nombre', 'belen_usuario_cargo', 'belen_medico_id', 'belen_medico_nombre',
         'belen_especialidad', 'belen_especialidad_codigo', 'belen_destino', 'belen_expediente_bloqueado'].forEach(k => sessionStorage.removeItem(k));
    }

    function puede(accion, rol) {
        const r = rol || (sesion() || {}).rol;
        return !!r && !!PERMISOS[accion] && PERMISOS[accion].includes(r);
    }

    function especialidadPorCodigo(codigo) { return ESPECIALIDADES.find(e => e.codigo === codigo) || null; }
    function medicosDeEspecialidad(codigo) {
        return Object.values(USUARIOS).filter(u => u.rol === 'medico' && u.especialidad_codigo === codigo);
    }

    // ---------------------------------------------------------------- Catálogo de pacientes
    function listarPacientes() { return leer(CLAVES.catalogo, []); }

    function buscarPacientePorIdentidad(nombre, fechaNacimiento) {
        const n = normalizar(nombre);
        if (!n || !fechaNacimiento) return null;
        return listarPacientes().find(p => normalizar(p.nombre_completo) === n && p.fecha_nacimiento === fechaNacimiento) || null;
    }
    function buscarPacientesPorNombre(texto, limite) {
        const n = normalizar(texto);
        if (n.length < 2) return [];
        return listarPacientes().filter(p => normalizar(p.nombre_completo).includes(n)).slice(0, limite || 6);
    }
    function buscarPacientePorId(id) { return listarPacientes().find(p => p.paciente_id === id) || null; }
    function homonimos(nombre, fechaNacimiento) {
        const n = normalizar(nombre);
        return listarPacientes().filter(p => normalizar(p.nombre_completo) === n && p.fecha_nacimiento !== fechaNacimiento);
    }

    function siguienteIdPaciente(lista) {
        const max = lista.reduce((m, p) => Math.max(m, parseInt(String(p.paciente_id).replace(/\D/g, ''), 10) || 0), 0);
        return 'PAC-' + String(max + 1).padStart(6, '0');
    }

    // Crea el paciente si no existe (por nombre + fecha de nacimiento); si existe, completa/actualiza datos de contacto
    function guardarPaciente(datos) {
        const lista = listarPacientes();
        const nombre = limpiarEspacios(datos.nombre_completo);
        let p = lista.find(x => normalizar(x.nombre_completo) === normalizar(nombre) && x.fecha_nacimiento === datos.fecha_nacimiento);
        if (!p) {
            p = {
                paciente_id: siguienteIdPaciente(lista),
                nombre_completo: nombre,
                fecha_nacimiento: datos.fecha_nacimiento,
                sexo: datos.sexo || null,
                creado_en: new Date().toISOString()
            };
            lista.push(p);
        }
        ['sexo', 'estado_civil', 'telefono', 'ocupacion', 'direccion'].forEach(k => { if (datos[k]) p[k] = datos[k]; });
        p.actualizado_en = new Date().toISOString();
        escribir(CLAVES.catalogo, lista);
        return p;
    }

    // ---------------------------------------------------------------- Turnos
    function listarTurnos() { return leer(CLAVES.turnos, []); }
    function obtenerTurno(id) { return listarTurnos().find(t => t.turno_id === id) || null; }

    function actualizarTurno(id, parche) {
        const lista = listarTurnos();
        const t = lista.find(x => x.turno_id === id);
        if (!t) return null;
        Object.assign(t, parche);
        t.actualizado_en = new Date().toISOString();
        escribir(CLAVES.turnos, lista);
        return t;
    }

    // Turno secuencial POR ESPECIALIDAD y por día (Cirugía General #1, Angiología #1, ...)
    function siguienteNumeroTurno(especialidadCodigo) {
        const hoy = hoyLocal();
        return listarTurnos()
            .filter(t => t.especialidad_codigo === especialidadCodigo && t.fecha_turno === hoy)
            .reduce((m, t) => Math.max(m, t.numero_turno), 0) + 1;
    }

    function crearTurno(datos) {
        const esp = especialidadPorCodigo(datos.especialidad_codigo);
        const medico = USUARIOS[datos.medico_id];
        const paciente = buscarPacientePorId(datos.paciente_id);
        if (!esp || !medico || !paciente) return null;
        const lista = listarTurnos();
        const turno = {
            turno_id: uid('T'),
            paciente_id: paciente.paciente_id,
            paciente_nombre: paciente.nombre_completo,
            fecha_nacimiento: paciente.fecha_nacimiento,
            sexo: paciente.sexo,
            especialidad_codigo: esp.codigo,
            especialidad: esp.nombre,
            medico_id: medico.medico_id,
            medico_nombre: medico.nombre,
            motivo: limpiarEspacios(datos.motivo),
            fecha_turno: hoyLocal(),
            numero_turno: siguienteNumeroTurno(esp.codigo),
            timestamp_llegada: new Date().toISOString(),
            estatus: ESTATUS.PENDIENTE_SIGNOS,
            signos_vitales: null,
            registrado_por: datos.registrado_por || null
        };
        lista.push(turno);
        escribir(CLAVES.turnos, lista);
        return turno;
    }

    // Fila ordenada ESTRICTAMENTE por llegada (el estatus o los signos nunca alteran el orden)
    function ordenarPorLlegada(turnos) {
        return turnos.slice().sort((a, b) => (a.timestamp_llegada < b.timestamp_llegada ? -1 : a.timestamp_llegada > b.timestamp_llegada ? 1 : a.numero_turno - b.numero_turno));
    }

    // PRIVACIDAD: un médico solo ve turnos propios; admin y enfermería ven todos
    function turnoVisiblePara(turno, s) {
        if (!s) return false;
        if (s.rol === 'medico') return turno.medico_id === s.medico_id;
        return s.rol === 'admin' || s.rol === 'enfermeria';
    }
    function filaDe(s, filtro) {
        filtro = filtro || {};
        return ordenarPorLlegada(listarTurnos().filter(t =>
            ESTATUS_EN_FILA.includes(t.estatus) && turnoVisiblePara(t, s) &&
            (!filtro.especialidad_codigo || t.especialidad_codigo === filtro.especialidad_codigo)));
    }
    function hospitalizadosDe(s) {
        return listarTurnos()
            .filter(t => (t.estatus === ESTATUS.INTERNADO_EN_PROCESO || t.estatus === ESTATUS.INTERNADO) && turnoVisiblePara(t, s))
            .sort((a, b) => (a.timestamp_llegada < b.timestamp_llegada ? 1 : -1));
    }

    // ---------------------------------------------------------------- Signos vitales
    const RANGOS_SIGNOS = {
        ta_sistolica:            { min: 50,  max: 260, entero: true,  etiqueta: 'Tensión arterial sistólica', unidad: 'mmHg' },
        ta_diastolica:           { min: 30,  max: 160, entero: true,  etiqueta: 'Tensión arterial diastólica', unidad: 'mmHg' },
        frecuencia_cardiaca:     { min: 20,  max: 250, entero: true,  etiqueta: 'Frecuencia cardíaca', unidad: 'lpm' },
        frecuencia_respiratoria: { min: 4,   max: 80,  entero: true,  etiqueta: 'Frecuencia respiratoria', unidad: 'rpm' },
        temperatura_c:           { min: 30,  max: 45,  entero: false, etiqueta: 'Temperatura', unidad: '°C' },
        spo2_porcentaje:         { min: 50,  max: 100, entero: true,  etiqueta: 'Saturación de oxígeno', unidad: '%' },
        peso_kg:                 { min: 0.3, max: 400, entero: false, etiqueta: 'Peso', unidad: 'kg', opcional: true },
        talla_m:                 { min: 0.3, max: 2.6, entero: false, etiqueta: 'Talla', unidad: 'm', opcional: true }
    };
    const SIGNOS_OBLIGATORIOS = ['ta_sistolica', 'ta_diastolica', 'frecuencia_cardiaca', 'frecuencia_respiratoria', 'temperatura_c', 'spo2_porcentaje'];

    // entrada: { campo: texto|numero }. Devuelve { ok, errores:{campo:mensaje}, valores:{campo:numero|null} }
    function validarSignos(entrada) {
        const errores = {}, valores = {};
        Object.keys(RANGOS_SIGNOS).forEach(campo => {
            const r = RANGOS_SIGNOS[campo];
            const crudo = String(entrada[campo] === undefined || entrada[campo] === null ? '' : entrada[campo]).trim().replace(',', '.');
            if (crudo === '') {
                valores[campo] = null;
                if (!r.opcional) errores[campo] = 'Obligatorio';
                return;
            }
            const n = Number(crudo);
            if (!Number.isFinite(n)) { errores[campo] = 'Número no válido'; return; }
            if (r.entero && !Number.isInteger(n)) { errores[campo] = 'Use un número entero'; return; }
            if (n < r.min || n > r.max) { errores[campo] = `Debe estar entre ${r.min} y ${r.max} ${r.unidad}`; return; }
            valores[campo] = n;
        });
        if (!errores.ta_sistolica && !errores.ta_diastolica && valores.ta_sistolica !== null && valores.ta_diastolica !== null && valores.ta_sistolica <= valores.ta_diastolica) {
            errores.ta_diastolica = 'La diastólica debe ser menor que la sistólica';
        }
        return { ok: Object.keys(errores).length === 0, errores: errores, valores: valores };
    }

    function signosCompletos(sv) {
        return !!sv && SIGNOS_OBLIGATORIOS.every(c => sv[c] !== null && sv[c] !== undefined && sv[c] !== '' && Number.isFinite(Number(sv[c])));
    }
    function resumenSignos(sv) {
        if (!sv) return null;
        const ta = (sv.ta_sistolica && sv.ta_diastolica) ? `${sv.ta_sistolica}/${sv.ta_diastolica}` : '--';
        return { ta: ta, fc: sv.frecuencia_cardiaca ?? '--', fr: sv.frecuencia_respiratoria ?? '--', temp: sv.temperatura_c ?? '--', spo2: sv.spo2_porcentaje ?? '--' };
    }

    // Guarda/edita signos. NO toca numero_turno ni timestamp_llegada: el orden de la fila no cambia.
    function guardarSignos(turnoId, valores, s) {
        const t = obtenerTurno(turnoId);
        if (!t) return null;
        const historial = (t.historial_signos || []).slice();
        if (t.signos_vitales) historial.push(t.signos_vitales);
        const sv = Object.assign({}, valores, {
            capturado_por: s ? s.nombre : null,
            capturado_por_rol: s ? s.rol : null,
            capturado_en: new Date().toISOString()
        });
        const parche = { signos_vitales: sv, historial_signos: historial };
        if (t.estatus === ESTATUS.PENDIENTE_SIGNOS && signosCompletos(sv)) parche.estatus = ESTATUS.SIGNOS_CAPTURADOS;
        return actualizarTurno(turnoId, parche);
    }

    // ---------------------------------------------------------------- Flujo de atención
    function pasarAMedico(turnoId, s) {
        const t = obtenerTurno(turnoId);
        if (!t || !ESTATUS_EN_FILA.includes(t.estatus)) return null;
        return actualizarTurno(turnoId, {
            estatus: ESTATUS.EN_CONSULTA,
            pase_por: s ? s.nombre : null, pase_por_rol: s ? s.rol : null,
            pase_en: new Date().toISOString(),
            pase_sin_signos: !signosCompletos(t.signos_vitales)
        });
    }
    function iniciarConsulta(turnoId, s) {
        const t = obtenerTurno(turnoId);
        if (!t) return null;
        if (t.estatus === ESTATUS.EN_CONSULTA) return t;
        if (!ESTATUS_EN_FILA.includes(t.estatus)) return null;
        return actualizarTurno(turnoId, {
            estatus: ESTATUS.EN_CONSULTA,
            pase_por: s ? s.nombre : null, pase_por_rol: s ? s.rol : null,
            pase_en: new Date().toISOString(),
            pase_sin_signos: !signosCompletos(t.signos_vitales)
        });
    }

    // Quién puede abrir expediente.html para un turno y en qué modo
    // modo: 'medico' (edita todo) | 'enfermeria' (solo Hoja Frontal y Consentimientos) | 'lectura'
    function accesoExpediente(s, turno) {
        if (!s) return { ok: false, motivo: 'Inicie sesión para continuar.' };
        if (!turno) return { ok: false, motivo: 'El turno solicitado no existe.' };
        const finalizado = turno.estatus === ESTATUS.INTERNADO || turno.estatus === ESTATUS.ALTA;
        if (s.rol === 'admin') return { ok: true, modo: finalizado ? 'lectura' : 'medico' };
        if (s.rol === 'medico') {
            if (turno.medico_id !== s.medico_id) return { ok: false, motivo: 'Este paciente pertenece a la fila de otro médico. Solo puede ver a sus propios pacientes.' };
            if (ESTATUS_EN_FILA.includes(turno.estatus) && turno.estatus !== ESTATUS.EN_CONSULTA) return { ok: false, motivo: 'Primero inicie la consulta desde su Dashboard (botón "Iniciar Consulta").' };
            if (turno.estatus === ESTATUS.ALTA) return { ok: false, motivo: 'La consulta de este paciente ya fue concluida con alta.' };
            return { ok: true, modo: finalizado ? 'lectura' : 'medico' };
        }
        if (s.rol === 'enfermeria') {
            if (turno.estatus === ESTATUS.INTERNADO_EN_PROCESO) return { ok: true, modo: 'enfermeria' };
            if (turno.estatus === ESTATUS.INTERNADO) return { ok: true, modo: 'lectura' };
            return { ok: false, motivo: 'Enfermería no puede iniciar consulta médica ni editar la Nota Médica. Solo accede a la Hoja Frontal y los Consentimientos de pacientes internados.' };
        }
        return { ok: false, motivo: 'Su perfil no tiene acceso al expediente.' };
    }

    // ---------------------------------------------------------------- Borradores del expediente (por turno)
    function leerBorrador(turnoId) { return (leer(CLAVES.borradores, {}) || {})[turnoId] || null; }
    function guardarBorrador(turnoId, borrador) {
        const todos = leer(CLAVES.borradores, {}) || {};
        todos[turnoId] = borrador;
        return escribir(CLAVES.borradores, todos);
    }
    function borrarBorrador(turnoId) {
        const todos = leer(CLAVES.borradores, {}) || {};
        delete todos[turnoId];
        return escribir(CLAVES.borradores, todos);
    }

    // ---------------------------------------------------------------- Visitas (expedientes finalizados)
    function listarVisitas() { return leer(CLAVES.visitas, []); }

    // Guarda el expediente completo y actualiza los datos demográficos del catálogo.
    function registrarVisita(expediente) {
        const lista = listarVisitas();
        const meta = expediente.meta || {};
        const visita = Object.assign({}, expediente);
        visita.meta = Object.assign({}, meta, { visita_id: meta.visita_id || uid('V') });
        const i = meta.turno_id ? lista.findIndex(v => v.meta && v.meta.turno_id === meta.turno_id) : -1;
        if (i >= 0) { visita.meta.visita_id = lista[i].meta.visita_id; lista[i] = visita; } else lista.push(visita);
        const okVisita = escribir(CLAVES.visitas, lista);
        // Datos demográficos "vivos" del paciente: el catálogo conserva lo más reciente
        const p = expediente.paciente || {};
        if (meta.paciente_id) {
            const cat = listarPacientes();
            const pac = cat.find(x => x.paciente_id === meta.paciente_id);
            if (pac) {
                ['estado_civil', 'telefono', 'ocupacion', 'direccion'].forEach(k => { if (p[k]) pac[k] = p[k]; });
                pac.ultima_visita_en = (expediente.consulta && expediente.consulta.fecha_hora) || new Date().toISOString();
                escribir(CLAVES.catalogo, cat);
            }
        }
        return okVisita ? visita : null;
    }

    function visitasDePaciente(pacienteId) {
        return listarVisitas()
            .filter(v => v.meta && v.meta.paciente_id === pacienteId)
            .sort((a, b) => String((b.consulta || {}).fecha_hora || '').localeCompare(String((a.consulta || {}).fecha_hora || '')));
    }

    // Autollenado longitudinal: última visita + cirugías confirmadas en episodios anteriores
    function antecedentesLongitudinales(pacienteId, excluirTurnoId) {
        const visitas = visitasDePaciente(pacienteId).filter(v => !excluirTurnoId || v.meta.turno_id !== excluirTurnoId);
        if (!visitas.length) return { total_visitas: 0, ultima_visita: null, cirugias_detectadas: [] };
        const ultima = visitas[0];
        const vistos = new Set();
        const cirugias = [];
        const agregar = (procedimiento, fechaTexto, complicaciones, origen, fechaVisita) => {
            const clave = normalizar(procedimiento);
            if (!clave || vistos.has(clave)) return;
            vistos.add(clave);
            cirugias.push({ procedimiento: limpiarEspacios(procedimiento), fecha_texto: fechaTexto || null, complicaciones: complicaciones || null, origen: origen, fecha_visita: fechaVisita || null });
        };
        // 1) Lo que el médico ya había registrado como antecedente quirúrgico en la última visita
        (((ultima.antecedentes || {}).personales_patologicos || {}).cirugias_previas || [])
            .forEach(q => agregar(q.procedimiento, q.fecha_texto, q.complicaciones, 'antecedente', null));
        // 2) Procedimientos quirúrgicos confirmados (consentimiento firmado) en CUALQUIER episodio anterior
        visitas.slice().reverse().forEach(v => {
            const f = ((v.consulta || {}).fecha_hora || '');
            const textoFecha = f ? fechaLegibleISO(f.slice(0, 10)) : null;
            (((v.consentimientos || {}).procedimientos) || []).forEach(c => agregar(c.procedimiento, textoFecha, null, 'consentimiento_quirurgico', f));
        });
        return { total_visitas: visitas.length, ultima_visita: ultima, cirugias_detectadas: cirugias };
    }

    // ---------------------------------------------------------------- Hospitalizados (arreglo de expedientes)
    function listarHospitalizados() { return leer(CLAVES.hospitalizados, []); }
    function guardarHospitalizado(expediente) {
        const lista = listarHospitalizados();
        const clave = x => ((x.meta && x.meta.turno_id) || '') + '|' + ((x.paciente && x.paciente.nombre_completo) || '') + '|' + ((x.consulta && x.consulta.fecha_hora) || '');
        const i = lista.findIndex(x => clave(x) === clave(expediente));
        if (i >= 0) lista[i] = expediente; else lista.push(expediente);
        return escribir(CLAVES.hospitalizados, lista);
    }

    // ---------------------------------------------------------------- Datos de demostración
    // Se siembran UNA sola vez (si el navegador no tiene catálogo ni visitas) para poder probar el autollenado.
    function expedienteDemo(p, v) {
        const normal = [['neuro', 'Neurológico'], ['cabeza', 'Cabeza y Cuello'], ['cardio', 'Cardiopulmonar'], ['abdomen', 'Abdomen'], ['rectal', 'Tacto Rectal / GU'], ['ext', 'Extremidades']]
            .map(([c, n]) => ({ sistema_codigo: c, sistema: n, estatus: 'NORMAL', hallazgo: null, fcf_lpm: null }));
        const medico = USUARIOS[v.medico_id];
        const pa = v.app || {};
        return {
            meta: { esquema_version: '1.0', generado_en: v.fecha, origen: 'demo', usuario_rol: 'medico', turno_id: v.turno_id, paciente_id: p.paciente_id,
                    medico_id: medico.medico_id, medico_nombre: medico.nombre, especialidad_codigo: medico.especialidad_codigo,
                    especialidad: (especialidadPorCodigo(medico.especialidad_codigo) || {}).nombre, numero_turno: 1, demo: true },
            paciente: {
                nombre_completo: p.nombre_completo, sexo: p.sexo, edad_anios: calcularEdad(p.fecha_nacimiento, new Date(v.fecha)), es_menor_edad: false,
                fecha_nacimiento: p.fecha_nacimiento, estado_civil: p.estado_civil || null, telefono: p.telefono || null, ocupacion: p.ocupacion || null, direccion: p.direccion || null,
                grupo_sanguineo: v.grupo || null,
                signos_vitales: { ta_sistolica: 128, ta_diastolica: 82, frecuencia_cardiaca: 76, frecuencia_respiratoria: 18, temperatura_c: 36.5, spo2_porcentaje: 97, peso_kg: v.peso || null, talla_m: v.talla || null, imc: null }
            },
            consulta: { fecha_hora: v.fecha, destino: v.destino, medico_tratante: medico.nombre, motivo_consulta: v.motivo, padecimiento_actual: v.padecimiento,
                        estudios_auxiliares: v.estudios || null, analisis_clinico: v.analisis, plan_tratamiento: v.plan, signos_alarma_explicados: 'Fiebre, dolor intenso o sangrado.', pronostico: 'Bueno para la vida y la función' },
            antecedentes: {
                heredofamiliares: { negado: false, detalle: v.ahf },
                no_patologicos: { negado: false, detalle: v.apnp },
                personales_patologicos: {
                    negado_todo: false,
                    hipertension: pa.hta || { presente: false, tiempo_evolucion: null, tratamiento: null, apego: null },
                    diabetes_mellitus_2: pa.dm2 || { presente: false, tiempo_evolucion: null, tratamiento: null, apego: null },
                    alergias: { presente: !!v.alergias, descripcion: v.alergias || null, sustancias: v.alergias ? [v.alergias] : [] },
                    transfusiones: { presente: false, detalle: null, complicaciones: null },
                    cirugias_previas: pa.cirugias || [],
                    otras_enfermedades: pa.otras || null
                },
                gineco_obstetricos: v.ago || null
            },
            exploracion_fisica: normal,
            diagnosticos: v.dx.map((d, i) => ({ orden: i + 1, es_principal: i === 0, cie10_codigo: d[0], descripcion: d[1] })),
            ingreso: { tipo_ingreso: v.destino === 'Hospitalizacion' ? 'Ingreso a Hospitalización' : (v.destino === 'Observacion' ? 'Ingreso a Observación Médica' : 'Ingreso General'),
                       area_destino: v.destino === 'Hospitalizacion' ? { codigo: 'HOSPITALIZACION', descripcion: 'Hospitalización' } : null,
                       cama_asignada: null, estatus_expediente: 'BLOQUEADO', responsable_legal: { mismo_paciente: true, nombre_completo: p.nombre_completo, parentesco: 'Mismo Paciente', telefono: p.telefono || null, direccion: p.direccion || null, misma_direccion_paciente: true } },
            consentimientos: { requiere_familiar_responsable: false, ingreso: { incluido: true },
                               procedimientos: (v.procedimientos || []).map((c, i) => ({ orden: i + 1, procedimiento: c[0], riesgos_objetivos: c[1] })) },
            indicaciones: { dieta: { texto: v.dieta || null, lineas: v.dieta ? [v.dieta] : [] }, soluciones_parenterales: { texto: null, lineas: [] },
                            medicamentos: { texto: v.medicamentos || null, lineas: v.medicamentos ? [v.medicamentos] : [] }, medidas_generales: { texto: null, lineas: [] },
                            interconsulta: { solicitada: false, especialidad: null, medico: null } }
        };
    }

    function sembrarDemoSiHaceFalta() {
        if (localStorage.getItem(CLAVES.catalogo) !== null || localStorage.getItem(CLAVES.visitas) !== null) return false;
        const carlos = { paciente_id: 'PAC-000001', nombre_completo: 'Carlos Ruiz Herrera', fecha_nacimiento: '1979-03-14', sexo: 'M', estado_civil: 'Casado(a)', telefono: '3221110001', ocupacion: 'Contador', direccion: 'Calle Morelos 120, Col. Centro', creado_en: '2026-03-12T09:00:00.000Z' };
        const laura = { paciente_id: 'PAC-000002', nombre_completo: 'Laura Méndez Olvera', fecha_nacimiento: '1991-07-22', sexo: 'F', estado_civil: 'Unión Libre', telefono: '3221110002', ocupacion: 'Maestra', direccion: 'Av. México 455, Col. Versalles', creado_en: '2026-08-02T09:00:00.000Z' };
        const visitaCarlos = expedienteDemo(carlos, {
            turno_id: 'T-DEMO-1', fecha: '2026-03-12T10:30:00.000Z', medico_id: 'dr_arturo', destino: 'Hospitalizacion', grupo: 'A+', peso: 84, talla: 1.74,
            motivo: 'Dolor en hipocondrio derecho', padecimiento: 'Cuadro de 3 días con dolor tipo cólico en hipocondrio derecho, náusea y vómito posprandial.',
            estudios: 'Ultrasonido abdominal: litiasis vesicular múltiple.', analisis: 'Colecistitis litiásica sin datos de choque.', plan: 'Colecistectomía laparoscópica programada.',
            ahf: 'Padre con diabetes mellitus tipo 2 y cardiopatía isquémica.', apnp: 'Tabaquismo suspendido hace 5 años; alcohol ocasional.', alergias: 'Penicilina',
            app: {
                hta: { presente: true, tiempo_evolucion: '8 años', tratamiento: 'Losartán 50 mg cada 24 h', apego: 'Buen apego' },
                dm2: { presente: true, tiempo_evolucion: '5 años', tratamiento: 'Metformina 850 mg cada 12 h', apego: 'Mal apego' },
                cirugias: [{ orden: 1, procedimiento: 'Apendicectomía', fecha_texto: '2005', complicaciones: 'Ninguna' }]
            },
            dx: [['K80.2', 'Colelitiasis sin colecistitis']], procedimientos: [['Colecistectomía laparoscópica', 'Sangrado, infección y lesión de vías biliares.']],
            dieta: 'Ayuno previo a cirugía; posterior dieta blanda.', medicamentos: 'Ceftriaxona 1 g IV cada 12 h'
        });
        const visitaLaura = expedienteDemo(laura, {
            turno_id: 'T-DEMO-2', fecha: '2026-08-02T16:10:00.000Z', medico_id: 'dr_juan', destino: 'Alta', grupo: 'O+', peso: 61, talla: 1.62,
            motivo: 'Cefalea y malestar general', padecimiento: 'Cefalea holocraneana de 2 días de evolución, sin fiebre.', analisis: 'Cefalea tensional.', plan: 'Analgésico y medidas generales.',
            ahf: 'Madre con hipotiroidismo.', apnp: 'Casa con todos los servicios; alimentación regular; sin tabaquismo.', alergias: 'Látex',
            app: { cirugias: [], otras: 'Migraña ocasional.' }, dx: [['R51', 'Cefalea']], medicamentos: 'Paracetamol 500 mg cada 8 h',
            ago: {
                fum: '2026-07-20', ritmo_menstrual: 'Regular', metodo_planificacion: 'DIU', gestas: 2, partos: 1, cesareas: 0, abortos: 1, solo_formula: false,
                detalle_gestas: [{ tipo: 'PARTO', numero: 1, detalle: 'Parto vaginal 2016 sin complicaciones', omitir: false }, { tipo: 'ABORTO', numero: 1, detalle: 'Aborto espontáneo 2019', omitir: false }],
                ivus: { no_referido: true, detalle: null }, ets: { no_referido: true, detalle: null }, numero_parejas_sexuales: { no_referido: false, valor: 1 },
                higiene_menstrual: { no_referido: false, tipo: 'TOALLAS', cantidad: '3 al día' },
                embarazo_actual: { presente: false, metodo_calculo_sdg: null, sdg: null, trimestre: null, consultas_prenatales: null, ultrasonidos: null, vacunas: [] }
            }
        });
        escribir(CLAVES.catalogo, [carlos, laura]);
        escribir(CLAVES.visitas, [visitaCarlos, visitaLaura]);
        escribir(CLAVES.demo, true);
        return true;
    }

    // Borra TODA la información operativa del demo (no toca los machotes) y vuelve a sembrar
    function restablecerDemo() {
        [CLAVES.catalogo, CLAVES.turnos, CLAVES.visitas, CLAVES.borradores, CLAVES.hospitalizados, CLAVES.demo].forEach(k => localStorage.removeItem(k));
        return sembrarDemoSiHaceFalta();
    }

    global.BelenStore = {
        CLAVES, ESPECIALIDADES, USUARIOS, PERMISOS, ESTATUS, ETIQUETA_ESTATUS, ESTATUS_EN_FILA, RANGOS_SIGNOS, SIGNOS_OBLIGATORIOS,
        leer, escribir, normalizar, limpiarEspacios, hoyLocal, parseFechaISO, calcularEdad, fechaLegibleISO, iniciales, formatoReloj,
        iniciarSesion, sesion, cerrarSesion, puede, especialidadPorCodigo, medicosDeEspecialidad,
        listarPacientes, buscarPacientePorIdentidad, buscarPacientesPorNombre, buscarPacientePorId, homonimos, guardarPaciente,
        listarTurnos, obtenerTurno, actualizarTurno, siguienteNumeroTurno, crearTurno, ordenarPorLlegada, turnoVisiblePara, filaDe, hospitalizadosDe,
        validarSignos, signosCompletos, resumenSignos, guardarSignos,
        pasarAMedico, iniciarConsulta, accesoExpediente,
        leerBorrador, guardarBorrador, borrarBorrador,
        listarVisitas, registrarVisita, visitasDePaciente, antecedentesLongitudinales,
        listarHospitalizados, guardarHospitalizado,
        sembrarDemoSiHaceFalta, restablecerDemo
    };
})(window);
