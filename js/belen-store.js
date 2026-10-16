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
//   belen_pacientes_hospitalizados ... arreglo de expedientes de pacientes internados. Cada elemento lleva además `internamiento`:
//                                el portafolio vivo (cama, interconsultas[], notas_evolucion[] SOAP, hojas_indicaciones[], cargos[], nota_egreso) espejado en cada cambio
//   belen_internamientos ....... episodio hospitalario (internamiento_id PK, FK turno_id, paciente_id, medico_tratante_id)
//                                con cama, interconsultas[], notas_evolucion[], hojas_indicaciones[], cargos[] y nota_egreso (inmutables: solo se agregan)
//   belen_permisos_personal .... { [usuario_id]: { ver_consultas, ver_hospitalizados, ver_quirofano, ver_farmacia } } (interruptores de Alfonso)
//   belen_cirugias ............. cirugías programadas (cirugia_id PK, FK paciente_id opcional, FK medico_cirujano_id)
//   belen_correcciones ......... bitácora de correcciones administrativas de datos del paciente
//   belen_catalogo_farmacia .... lotes (sku, laboratorio, categoría, fracción COFEPRIS, IVA, lote, caducidad, stock, precios)
//   belen_cola_surtido ......... solicitudes de piso y de consulta pendientes de surtir
//   belen_paquetes_farmacia .... paquetes quirúrgicos / clínicos (ítems y cantidades)
//   belen_cajas_estupefacientes  cajas de fracción I (ámpulas usadas contra receta especial)
//   belen_movimientos_farmacia . kárdex inmutable de entradas y salidas (movimiento_id PK)
// ============================================================
(function (global) {
    'use strict';

    const CLAVES = {
        catalogo: 'belen_catalogo_pacientes',
        turnos: 'belen_turnos',
        visitas: 'belen_visitas',
        borradores: 'belen_borradores',
        hospitalizados: 'belen_pacientes_hospitalizados',
        internamientos: 'belen_internamientos',
        permisosPersonal: 'belen_permisos_personal',
        correcciones: 'belen_correcciones',
        cirugias: 'belen_cirugias',
        farmacia: 'belen_catalogo_farmacia',
        surtido: 'belen_cola_surtido',
        paquetes: 'belen_paquetes_farmacia',
        cajasEstupefacientes: 'belen_cajas_estupefacientes',
        salidasFarmacia: 'belen_bitacora_salidas',
        movimientosFarmacia: 'belen_movimientos_farmacia',
        ivaDiferido: 'belen_iva_diferido_v1',
        farmaciaAmpliada: 'belen_farmacia_ampliada_v2',
        usuarios: 'belen_usuarios',
        papeleria: 'belen_papeleria_personal',
        demo: 'belen_demo_sembrado'
    };

    // ---------------------------------------------------------------- Catálogos
    const ESPECIALIDADES = [
        { codigo: 'MEDICINA_GENERAL', nombre: 'Medicina General' },
        { codigo: 'ANGIOLOGIA', nombre: 'Angiología' },
        { codigo: 'CIRUGIA_GENERAL', nombre: 'Cirugía General' },
        { codigo: 'MEDICINA_INTERNA', nombre: 'Medicina Interna' },
        { codigo: 'ANESTESIOLOGIA', nombre: 'Anestesiología' },
        { codigo: 'GINECOLOGIA_OBSTETRICIA', nombre: 'Ginecología y Obstetricia' },
        { codigo: 'TRAUMATOLOGIA_ORTOPEDIA', nombre: 'Traumatología y Ortopedia' }
    ];

    // Roles del ERP (los 4 médicos comparten el rol 'medico' y se distinguen por medico_id):
    //   admin ........ Alfonso: poderes absolutos (gestiona personal, ve todo, conserva todos los módulos)
    //   administrador  Caja y Recepción: registra pacientes, fila de espera, métricas y cirugías (sin expedientes clínicos)
    //   enf_triage ... Enfermería de Triage (signos vitales y envío al médico)
    //   enf_hospital . Enfermería de Hospitalización (camas, Hoja Frontal y Consentimientos)
//   enf_quirofano  Enfermería de Quirófano (cirugías programadas)
//   enf_farmacia . Encargado de Farmacia (inventario y surtido a piso)
//   medico ....... Médicos
    const ROLES = {
        admin:         { codigo: 'admin',         etiqueta: 'Administración General',        corta: 'Administración', color: 'bg-slate-800 text-white' },
        administrador: { codigo: 'administrador', etiqueta: 'Caja y Recepción',              corta: 'Caja y Recepción', color: 'bg-amber-100 text-amber-800' },
        enf_triage:    { codigo: 'enf_triage',    etiqueta: 'Enfermería de Triage',          corta: 'Enfermería · Triage', color: 'bg-cyan-100 text-cyan-700' },
        enf_hospital:  { codigo: 'enf_hospital',  etiqueta: 'Enfermería de Hospitalización', corta: 'Enfermería · Hospital', color: 'bg-indigo-100 text-indigo-700' },
        enf_quirofano: { codigo: 'enf_quirofano', etiqueta: 'Enfermería de Quirófano',       corta: 'Enfermería · Quirófano', color: 'bg-violet-100 text-violet-700' },
        enf_farmacia:  { codigo: 'enf_farmacia',  etiqueta: 'Terminal de Farmacia (Kiosco)', corta: 'Kiosco', color: 'bg-teal-100 text-teal-800' },
        medico:        { codigo: 'medico',        etiqueta: 'Médico',                        corta: 'Médico', color: 'bg-emerald-100 text-emerald-700' }
    };
    const ENFERMERIAS = ['enf_triage', 'enf_hospital', 'enf_quirofano'];
    const PERSONAL_OPERATIVO = ['admin', 'administrador'].concat(ENFERMERIAS);   // todo el personal no médico
    function esEnfermeria(rol) { return ENFERMERIAS.includes(rol); }

    // Catálogo vivo. Se llena desde belen_usuarios (localStorage) al arrancar; el código ya no es la fuente de verdad.
    const USUARIOS = {};
    const SEMILLA_USUARIOS = [
        { id: 'admin',         rol: 'admin',         nombre: 'Alfonso',            cargo: 'Dirección General',              cedula_profesional: '',        codigo_rapido: '1111', especialidad_codigo: null,                    color_distintivo: 'slate',   etiqueta_admin: 'Dirección' },
        { id: 'administrador', rol: 'administrador', nombre: 'Adm. Sofía',         cargo: 'Caja y Recepción',               cedula_profesional: '',        codigo_rapido: '3301', especialidad_codigo: null,                    color_distintivo: 'amber',   etiqueta_admin: 'Caja' },
        { id: 'enf_triage',    rol: 'enf_triage',    nombre: 'Enf. Lupita',        cargo: 'Enfermería de Triage',           cedula_profesional: 'ENF-2201', codigo_rapido: '2201', especialidad_codigo: null,                   color_distintivo: 'cyan',    etiqueta_admin: 'Triage matutino' },
        { id: 'enf_hospital',  rol: 'enf_hospital',  nombre: 'Enf. Carmen',        cargo: 'Enfermería de Hospitalización',  cedula_profesional: 'ENF-2202', codigo_rapido: '2202', especialidad_codigo: null,                   color_distintivo: 'cyan',    etiqueta_admin: 'Piso' },
        { id: 'enf_quirofano', rol: 'enf_quirofano', nombre: 'Enf. Rosa',          cargo: 'Enfermería de Quirófano',        cedula_profesional: 'ENF-2203', codigo_rapido: '2203', especialidad_codigo: null,                   color_distintivo: 'violet',  etiqueta_admin: 'Sala' },
        { id: 'enf_farmacia',  rol: 'enf_farmacia',  nombre: 'Terminal de Farmacia', cargo: 'Terminal de Farmacia (Kiosco)', cedula_profesional: '', codigo_rapido: '9001', especialidad_codigo: null, color_distintivo: 'emerald', etiqueta_admin: 'Computadora fija de farmacia' },
        { id: 'dr_juan',       rol: 'medico',        nombre: 'Dr. Juan Pérez',     cargo: 'Medicina General',               cedula_profesional: 'MG-11021', codigo_rapido: '1021', especialidad_codigo: 'MEDICINA_GENERAL',     color_distintivo: 'emerald', etiqueta_admin: 'Consulta general' },
        { id: 'dr_roberto',    rol: 'medico',        nombre: 'Dr. Roberto Flores', cargo: 'Angiología',                     cedula_profesional: 'ANG-3340', codigo_rapido: '3340', especialidad_codigo: 'ANGIOLOGIA',           color_distintivo: 'amber',   etiqueta_admin: 'Vascular' },
        { id: 'dr_arturo',     rol: 'medico',        nombre: 'Dr. Arturo Gómez',   cargo: 'Cirugía General',                cedula_profesional: 'CG-7781',  codigo_rapido: '7781', especialidad_codigo: 'CIRUGIA_GENERAL',      color_distintivo: 'violet',  etiqueta_admin: 'Cirujano' },
        { id: 'dr_internista', rol: 'medico',        nombre: 'Dr. Carlos Méndez',  cargo: 'Medicina Interna',               cedula_profesional: 'MI-5520',  codigo_rapido: '5520', especialidad_codigo: 'MEDICINA_INTERNA',     color_distintivo: 'cyan',    etiqueta_admin: 'Internista' },
        { id: 'dra_elena',     rol: 'medico',        nombre: 'Dra. Elena Ríos',    cargo: 'Anestesiología',                 cedula_profesional: 'AE-45821', codigo_rapido: '4582', especialidad_codigo: 'ANESTESIOLOGIA',       color_distintivo: 'rose',    etiqueta_admin: 'Anestesia' }
    ];
    const COLORES_DISTINTIVO = {
        emerald: { clase: 'bg-emerald-100 text-emerald-800', etiqueta: 'Esmeralda' },
        cyan:    { clase: 'bg-cyan-100 text-cyan-800',       etiqueta: 'Cian' },
        rose:    { clase: 'bg-rose-100 text-rose-800',       etiqueta: 'Rosa' },
        violet:  { clase: 'bg-violet-100 text-violet-800',   etiqueta: 'Violeta' },
        amber:   { clase: 'bg-amber-100 text-amber-800',     etiqueta: 'Ámbar' },
        slate:   { clase: 'bg-slate-800 text-white',         etiqueta: 'Pizarra' }
    };
    const ACCIONES_PERSONAL = ['capturar_signos', 'pasar_a_medico', 'cargar_consumos', 'asignar_cama', 'programar_cirugia', 'gestionar_farmacia', 'farmacia_paquetes', 'farmacia_estupefacientes', 'ver_bitacora_farmacia'];
    // Alias de versiones anteriores del demo (el rol genérico 'enfermeria' se dividió en tres roles específicos)
    const ALIAS_USUARIO = { doctor: 'dr_juan', medico: 'dr_juan', enfermera: 'enf_triage', enfermeria: 'enf_triage', recepcion: 'administrador', caja: 'administrador' };

    // Matriz de permisos por rol (una sola fuente de verdad para toda la aplicación)
    const PERMISOS = {
        ver_dashboard_admin:       ['admin', 'administrador'],
        ver_metricas:              ['admin', 'administrador'],               // barra de métricas de 24 horas del Dashboard Central
        registrar_paciente:        ['admin', 'administrador'],
        registrar_consulta_directa:['medico'],   // el médico solo puede registrarse pacientes a sí mismo
        ver_fila_completa:         PERSONAL_OPERATIVO,
        capturar_signos:           PERSONAL_OPERATIVO.concat(['medico']),     // el médico los captura dentro de su nota (no desde la fila)
        pasar_a_medico:            PERSONAL_OPERATIVO,
        iniciar_consulta:          ['admin', 'medico'],
        editar_nota_medica:        ['admin', 'medico'],
        editar_indicaciones:       ['admin', 'medico'],
        editar_hoja_frontal:       ['admin'].concat(ENFERMERIAS, ['medico']),
        editar_consentimientos:    ['admin'].concat(ENFERMERIAS, ['medico']),
        finalizar_expediente:      ['admin', 'medico'],
        ver_historial_visitas:     ['admin', 'medico'],
        ver_expedientes_catalogo:  ['admin', 'medico'],
        // ---- MÓDULOS (interruptor por usuario en Gestión de Personal). El valor por defecto es el de esta matriz.
        ver_consultas:             ['admin', 'administrador', 'enf_triage', 'medico'],
        ver_hospitalizados:        ['admin', 'administrador', 'enf_hospital', 'medico'],
        ver_quirofano:             ['admin', 'administrador', 'enf_quirofano', 'medico'],
        ver_farmacia:              ['admin', 'administrador', 'enf_farmacia'],
        // ----
        gestionar_personal:        ['admin'],
        asignar_cama:              ['admin'].concat(ENFERMERIAS),
        programar_cirugia:         ['admin', 'administrador'],
        corregir_datos_paciente:   ['admin'],
        dar_alta_hospital:         ['medico'],                           // solo el médico tratante (se valida la relación)
        cargar_consumos:           ['admin', 'administrador'].concat(ENFERMERIAS),
        ver_cuentas_cobrar:        ['admin', 'administrador'],
        cerrar_expediente_pago:    ['admin', 'administrador'],
        cargar_cuenta_consulta:    ['admin', 'medico'],
        gestionar_farmacia:        ['admin', 'administrador', 'enf_farmacia'],
        farmacia_paquetes:         ['admin'],
        farmacia_estupefacientes:  ['admin'],
        ver_bitacora_farmacia:     ['admin']
    };

    // Módulos que Alfonso puede encender/apagar por usuario. 'roles' = perfiles a los que el módulo puede aplicar (un switch fuera de
    // esa lista no tiene efecto). El valor por defecto sale de PERMISOS; el interruptor guardado en belen_permisos_personal lo sobrescribe.
    const MODULOS = [
        { permiso: 'ver_consultas',      etiqueta: 'Triage/Consulta',  icono: 'fa-stethoscope', vistas: ['central', 'fila', 'expedientes'],
          roles: ['admin', 'administrador', 'enf_triage', 'enf_hospital', 'enf_quirofano', 'medico'],
          descripcion: 'Dashboard central, fila de espera inteligente, triage y expedientes clínicos.' },
        { permiso: 'ver_hospitalizados', etiqueta: 'Hospitalización', icono: 'fa-bed-pulse',   vistas: ['hospitalizacion'],
          roles: ['admin', 'administrador', 'enf_triage', 'enf_hospital', 'enf_quirofano', 'medico'],
          descripcion: 'Monitor de camas, cuenta del internamiento y visor del expediente.' },
        { permiso: 'ver_quirofano',      etiqueta: 'Quirófano',       icono: 'fa-kit-medical', vistas: ['cirugias'],
          roles: ['admin', 'administrador', 'enf_triage', 'enf_hospital', 'enf_quirofano', 'enf_farmacia', 'medico'],
          descripcion: 'Próximas cirugías. El médico solo ve en las que participa como cirujano, anestesiólogo o interconsultado.' },
        { permiso: 'ver_farmacia',       etiqueta: 'Farmacia',        icono: 'fa-pills',       vistas: ['farmacia'],
          roles: ['admin', 'administrador', 'enf_farmacia'],
          descripcion: 'La terminal de farmacia y las sesiones de dirección y caja. El personal clínico no abre este módulo en su computadora.' }
    ];
    const PERMISOS_MODULO = MODULOS.map(m => m.permiso);
    // Alfonso puede encender cualquier módulo en cualquier perfil. El arreglo roles de MODULOS solo documenta el público habitual.
    function moduloAplicaARol(permiso) {
        return PERMISOS_MODULO.includes(permiso);
    }

    const ESTATUS = {
        PENDIENTE_SIGNOS: 'pendiente_signos',
        SIGNOS_CAPTURADOS: 'signos_capturados',
        EN_CONSULTA: 'en_consulta',
        INTERNADO_EN_PROCESO: 'internado_en_proceso',
        INTERNADO: 'internado',
        ALTA: 'alta',
        ALTA_PENDIENTE_PAGO: 'alta_medica_pendiente_pago',
        CERRADO_HISTORICO: 'cerrado_historico'
    };
    const ETIQUETA_ESTATUS = {
        pendiente_signos: 'Pendiente de signos vitales',
        signos_capturados: 'Signos capturados',
        en_consulta: 'En consulta',
        internado_en_proceso: 'Internamiento en proceso',
        internado: 'Internado',
        alta: 'Alta',
        alta_medica_pendiente_pago: 'Alta médica · pendiente de pago',
        cerrado_historico: 'Cerrado (histórico)'
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

    function hashContrasena(texto) {
        const K = new Uint32Array([
            0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
            0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
            0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
            0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
            0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
            0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
            0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
            0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
        ]);
        const bytes = new TextEncoder().encode(String(texto));
        const withPad = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
        withPad.set(bytes);
        withPad[bytes.length] = 0x80;
        const view = new DataView(withPad.buffer);
        const bitLen = bytes.length * 8;
        view.setUint32(withPad.length - 8, Math.floor(bitLen / 0x100000000));
        view.setUint32(withPad.length - 4, bitLen >>> 0);
        let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a, h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
        const w = new Uint32Array(64);
        const rotr = (x, n) => (x >>> n) | (x << (32 - n));
        for (let i = 0; i < withPad.length; i += 64) {
            for (let t = 0; t < 16; t++) w[t] = view.getUint32(i + t * 4);
            for (let t = 16; t < 64; t++) {
                const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
                const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
                w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
            }
            let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
            for (let t = 0; t < 64; t++) {
                const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
                const ch = (e & f) ^ ((~e) & g);
                const t1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
                const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
                const maj = (a & b) ^ (a & c) ^ (b & c);
                const t2 = (S0 + maj) >>> 0;
                h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
            }
            h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
            h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
        }
        return [h0, h1, h2, h3, h4, h5, h6, h7].map(x => x.toString(16).padStart(8, '0')).join('');
    }
    function publicarUsuarios(lista) {
        Object.keys(USUARIOS).forEach(k => delete USUARIOS[k]);
        (lista || []).forEach(u => {
            const copia = Object.assign({ activo: true, cedula_profesional: '', especialidad_codigo: null, color_distintivo: 'slate', etiqueta_admin: '' }, u);
            if (copia.rol === 'medico') copia.medico_id = copia.id;
            else delete copia.medico_id;
            USUARIOS[copia.id] = copia;
        });
    }
    function listaUsuariosCruda() { return leer(CLAVES.usuarios, []); }
    function guardarListaUsuarios(lista) {
        const ok = escribir(CLAVES.usuarios, lista);
        if (ok) publicarUsuarios(lista);
        return ok;
    }
    function sembrarUsuariosSiHaceFalta() {
        const hash = hashContrasena('demo');
        const actual = localStorage.getItem(CLAVES.usuarios);
        if (actual === null) {
            return guardarListaUsuarios(SEMILLA_USUARIOS.map(u => Object.assign({ password_hash: hash, activo: true }, u)));
        }
        const lista = listaUsuariosCruda();
        const ids = new Set(lista.map(u => u.id));
        const faltan = SEMILLA_USUARIOS.filter(u => !ids.has(u.id)).map(u => Object.assign({ password_hash: hash, activo: true }, u));
        if (faltan.length) guardarListaUsuarios(lista.concat(faltan));
        else publicarUsuarios(lista);
        completarCodigosRapidos();
        etiquetarKioscoFarmacia();
        return true;
    }
    function etiquetarKioscoFarmacia() {
        const lista = listaUsuariosCruda();
        const u = lista.find(x => x.id === 'enf_farmacia');
        if (!u) return;
        let cambio = false;
        if (u.nombre === 'Enf. Patricia') { u.nombre = 'Terminal de Farmacia'; cambio = true; }
        if (u.cargo === 'Encargado de Farmacia') { u.cargo = 'Terminal de Farmacia (Kiosco)'; cambio = true; }
        if (u.codigo_rapido === '2204') { u.codigo_rapido = '9001'; cambio = true; }
        if (u.cedula_profesional === 'ENF-2204') { u.cedula_profesional = ''; cambio = true; }
        if (cambio) guardarListaUsuarios(lista);
    }
    function esCuentaKioscoFarmacia(u) { return !!u && (u.id === 'enf_farmacia' || u.rol === 'enf_farmacia'); }
    function completarCodigosRapidos() {
        const lista = listaUsuariosCruda();
        let cambio = false;
        lista.forEach(u => {
            if (u.codigo_rapido) return;
            const semilla = SEMILLA_USUARIOS.find(x => x.id === u.id);
            if (semilla && semilla.codigo_rapido) { u.codigo_rapido = semilla.codigo_rapido; cambio = true; }
        });
        if (cambio) guardarListaUsuarios(lista);
    }
    function identificarOperadorFarmacia(codigo) {
        const c = String(codigo || '').trim();
        if (!c) return { ok: false, motivo: 'Escriba su código personal.' };
        const activos = Object.values(USUARIOS).filter(u => u.activo !== false && !esCuentaKioscoFarmacia(u));
        const porPin = activos.filter(u => u.codigo_rapido && String(u.codigo_rapido) === c);
        if (porPin.length === 1) return { ok: true, usuario: porPin[0] };
        if (porPin.length > 1) return { ok: false, motivo: 'Ese código está repetido. Pida a dirección que lo corrija.' };
        const hash = hashContrasena(c);
        const porPass = activos.filter(u => u.password_hash === hash);
        if (porPass.length === 1) return { ok: true, usuario: porPass[0] };
        if (porPass.length > 1) return { ok: false, motivo: 'Esa contraseña la comparten varias cuentas. Use su código personal.' };
        return { ok: false, motivo: 'Código o contraseña no reconocidos.' };
    }
    function usuarioPorId(id) { return USUARIOS[id] || null; }
    function colorDeUsuario(u) {
        const c = u && COLORES_DISTINTIVO[u.color_distintivo];
        return c ? c.clase : ((ROLES[u && u.rol] || {}).color || 'bg-slate-100 text-slate-700');
    }
    function iniciarSesion(idEntrada, password) {
        sembrarUsuariosSiHaceFalta();
        const id = normalizar(idEntrada);
        const u = USUARIOS[ALIAS_USUARIO[id] || id];
        if (!u) return { motivo: 'usuario' };
        if (u.activo === false) return { motivo: 'inactivo' };
        if (hashContrasena(password || '') !== u.password_hash) return { motivo: 'password' };
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
        if (!s.usuario_id || !USUARIOS[s.usuario_id] || USUARIOS[s.usuario_id].activo === false) return null;
        if (rol === 'medico' && !s.medico_id) return null;
        return s;
    }

    function cerrarSesion() {
        ['belen_rol_usuario', 'belen_usuario_id', 'belen_usuario_nombre', 'belen_usuario_cargo', 'belen_medico_id', 'belen_medico_nombre',
         'belen_especialidad', 'belen_especialidad_codigo', 'belen_destino', 'belen_expediente_bloqueado'].forEach(k => sessionStorage.removeItem(k));
    }

    // Permisos por usuario de los MÓDULOS (interruptores del administrador). Se leen siempre de localStorage:
    // apagar un módulo lo retira del sidebar del usuario (en su próxima sesión o al refrescar su dashboard).
    function leerPermisosPersonal() { return leer(CLAVES.permisosPersonal, {}) || {}; }
    function permisoModuloExplicito(usuarioId, permiso) {
        const ajuste = (leerPermisosPersonal()[usuarioId] || {})[permiso];
        return typeof ajuste === 'boolean' ? ajuste : undefined;
    }
    function permisoModuloDe(usuarioId, permiso) {
        const u = USUARIOS[usuarioId];
        if (!u || !PERMISOS[permiso] || u.activo === false) return false;
        if (u.rol === 'admin') return true;                       // Alfonso no puede quedarse sin módulos
        if (!moduloAplicaARol(permiso)) return false;
        const ajuste = permisoModuloExplicito(usuarioId, permiso);
        return typeof ajuste === 'boolean' ? ajuste : PERMISOS[permiso].includes(u.rol);
    }
    function establecerPermisoModulo(usuarioId, permiso, valor) {
        if (!USUARIOS[usuarioId] || USUARIOS[usuarioId].rol === 'admin' || !PERMISOS_MODULO.includes(permiso)) return false;
        const todos = leerPermisosPersonal();
        todos[usuarioId] = Object.assign({}, todos[usuarioId], { [permiso]: !!valor });
        return escribir(CLAVES.permisosPersonal, todos);
    }
    function permisoAccionDe(usuarioId, accion) {
        const u = USUARIOS[usuarioId];
        if (!u || !PERMISOS[accion] || u.activo === false) return false;
        if (u.rol === 'admin') return true;
        const ajuste = (leerPermisosPersonal()[usuarioId] || {})[accion];
        return typeof ajuste === 'boolean' ? ajuste : PERMISOS[accion].includes(u.rol);
    }
    function establecerPermisoAccion(usuarioId, accion, valor) {
        if (!USUARIOS[usuarioId] || USUARIOS[usuarioId].rol === 'admin' || !ACCIONES_PERSONAL.includes(accion)) return false;
        const todos = leerPermisosPersonal();
        todos[usuarioId] = Object.assign({}, todos[usuarioId], { [accion]: !!valor });
        return escribir(CLAVES.permisosPersonal, todos);
    }
    function restablecerPermisosPersonal(usuarioId) {
        const todos = leerPermisosPersonal();
        delete todos[usuarioId];
        return escribir(CLAVES.permisosPersonal, todos);
    }

    function puede(accion, rol) {
        if (!rol) {
            const s = sesion();
            if (PERMISOS_MODULO.includes(accion)) return !!s && permisoModuloDe(s.usuario_id, accion);
            if (ACCIONES_PERSONAL.includes(accion)) return !!s && permisoAccionDe(s.usuario_id, accion);
        }
        const r = rol || (sesion() || {}).rol;
        return !!r && !!PERMISOS[accion] && PERMISOS[accion].includes(r);
    }

    function especialidadPorCodigo(codigo) { return ESPECIALIDADES.find(e => e.codigo === codigo) || null; }
    function medicosActivos() { return Object.values(USUARIOS).filter(u => u.rol === 'medico' && u.activo !== false); }
    function medicosDeEspecialidad(codigo) {
        return medicosActivos().filter(u => u.especialidad_codigo === codigo);
    }
    function validarUsuario(entrada, idActual) {
        const v = {
            id: normalizar(entrada.id), nombre: limpiarEspacios(entrada.nombre), rol: entrada.rol || '',
            cargo: limpiarEspacios(entrada.cargo), cedula_profesional: limpiarEspacios(entrada.cedula_profesional).toUpperCase(),
            especialidad_codigo: entrada.rol === 'medico' ? (entrada.especialidad_codigo || '') : null,
            color_distintivo: entrada.color_distintivo || 'slate', etiqueta_admin: limpiarEspacios(entrada.etiqueta_admin),
            codigo_rapido: String(entrada.codigo_rapido || '').trim(),
            password: String(entrada.password || '')
        };
        const errores = {};
        if (!/^[a-z][a-z0-9_]{1,30}$/.test(v.id)) errores.id = 'El usuario inicia con letra y usa minúsculas, números o guion bajo (2 a 31).';
        else if (USUARIOS[v.id] && v.id !== idActual) errores.id = 'Ese usuario ya existe.';
        if (v.nombre.length < 2 || v.nombre.length > 80) errores.nombre = 'Escriba el nombre (2 a 80 caracteres).';
        if (!ROLES[v.rol]) errores.rol = 'Seleccione un perfil.';
        if (v.cargo.length < 2 || v.cargo.length > 60) errores.cargo = 'Escriba el cargo (2 a 60 caracteres).';
        if (v.cedula_profesional && !/^[A-Z0-9-]{4,20}$/.test(v.cedula_profesional)) errores.cedula_profesional = 'La cédula usa letras, números o guiones (4 a 20).';
        if (v.rol === 'medico' && !especialidadPorCodigo(v.especialidad_codigo)) errores.especialidad_codigo = 'Seleccione la especialidad.';
        if (!COLORES_DISTINTIVO[v.color_distintivo]) errores.color_distintivo = 'Seleccione un color.';
        if (v.etiqueta_admin.length > 80) errores.etiqueta_admin = 'La etiqueta admite hasta 80 caracteres.';
        if (!idActual && v.password.length < 4) errores.password = 'La contraseña debe tener al menos 4 caracteres.';
        if (idActual && v.password && v.password.length < 4) errores.password = 'La contraseña nueva debe tener al menos 4 caracteres.';
        if (!/^\d{4,8}$/.test(v.codigo_rapido)) errores.codigo_rapido = 'El código rápido es de 4 a 8 dígitos.';
        else if (Object.values(USUARIOS).some(u => u.id !== (idActual || v.id) && String(u.codigo_rapido) === v.codigo_rapido)) errores.codigo_rapido = 'Ese código rápido ya lo usa otra persona.';
        return { ok: Object.keys(errores).length === 0, errores: errores, valores: v };
    }
    function reasignarIdUsuario(antes, despues) {
        if (!antes || antes === despues) return;
        const permisos = leerPermisosPersonal();
        if (permisos[antes]) { permisos[despues] = permisos[antes]; delete permisos[antes]; escribir(CLAVES.permisosPersonal, permisos); }
        const papeles = leer(CLAVES.papeleria, {}) || {};
        if (papeles[antes]) { papeles[despues] = papeles[antes]; delete papeles[antes]; escribir(CLAVES.papeleria, papeles); }
        const cirugias = listarCirugias();
        cirugias.forEach(c => {
            if (c.medico_cirujano_id === antes) c.medico_cirujano_id = despues;
            if (c.anestesiologo_id === antes) c.anestesiologo_id = despues;
        });
        escribir(CLAVES.cirugias, cirugias);
        const turnos = listarTurnos();
        turnos.forEach(t => { if (t.medico_id === antes) t.medico_id = despues; });
        escribir(CLAVES.turnos, turnos);
        const ints = listarInternamientos();
        ints.forEach(i => {
            if (i.medico_tratante_id === antes) i.medico_tratante_id = despues;
            (i.interconsultas || []).forEach(x => { if (x.medico_id === antes) x.medico_id = despues; });
        });
        escribir(CLAVES.internamientos, ints);
    }
    function guardarUsuario(entrada, s, idActual) {
        if (!s || !PERMISOS.gestionar_personal.includes(s.rol)) return { ok: false, motivo: 'Solo la administración puede editar el personal.' };
        const r = validarUsuario(entrada, idActual || null);
        if (!r.ok) return { ok: false, motivo: 'Revise los campos marcados.', errores: r.errores };
        const v = r.valores;
        if (idActual === 'admin' && (v.id !== 'admin' || v.rol !== 'admin')) return { ok: false, motivo: 'La cuenta de dirección no puede cambiar de usuario ni de perfil.' };
        if (idActual && idActual !== v.id && (idActual === s.usuario_id)) return { ok: false, motivo: 'No puede cambiar su propio usuario mientras tiene la sesión abierta.' };
        const lista = listaUsuariosCruda();
        const previo = idActual ? lista.find(u => u.id === idActual) : null;
        if (idActual && !previo) return { ok: false, motivo: 'No se encontró al empleado.' };
        const registro = Object.assign({}, previo || { activo: true }, {
            id: v.id, nombre: v.nombre, rol: v.rol, cargo: v.cargo, cedula_profesional: v.cedula_profesional,
            especialidad_codigo: v.especialidad_codigo, color_distintivo: v.color_distintivo, etiqueta_admin: v.etiqueta_admin,
            codigo_rapido: v.codigo_rapido
        });
        if (v.password) registro.password_hash = hashContrasena(v.password);
        if (!registro.password_hash) registro.password_hash = hashContrasena('demo');
        if (idActual && idActual !== v.id) reasignarIdUsuario(idActual, v.id);
        const siguiente = idActual ? lista.map(u => u.id === idActual ? registro : u) : lista.concat([registro]);
        return guardarListaUsuarios(siguiente) ? { ok: true, usuario: USUARIOS[v.id] } : { ok: false, motivo: 'No se pudo guardar (almacenamiento lleno o bloqueado).' };
    }
    function desactivarUsuario(id, s) {
        if (!s || !PERMISOS.gestionar_personal.includes(s.rol)) return { ok: false, motivo: 'Solo la administración puede desactivar personal.' };
        if (id === 'admin' || id === s.usuario_id) return { ok: false, motivo: 'Esa cuenta no se puede desactivar.' };
        const lista = listaUsuariosCruda();
        const u = lista.find(x => x.id === id);
        if (!u) return { ok: false, motivo: 'No se encontró al empleado.' };
        u.activo = false;
        return guardarListaUsuarios(lista) ? { ok: true, usuario: USUARIOS[id] } : { ok: false, motivo: 'No se pudo guardar.' };
    }
    function reactivarUsuario(id, s) {
        if (!s || !PERMISOS.gestionar_personal.includes(s.rol)) return { ok: false, motivo: 'Solo la administración puede reactivar personal.' };
        const lista = listaUsuariosCruda();
        const u = lista.find(x => x.id === id);
        if (!u) return { ok: false, motivo: 'No se encontró al empleado.' };
        u.activo = true;
        return guardarListaUsuarios(lista) ? { ok: true, usuario: USUARIOS[id] } : { ok: false, motivo: 'No se pudo guardar.' };
    }
    function eliminarUsuario(id, s) {
        if (!s || !PERMISOS.gestionar_personal.includes(s.rol)) return { ok: false, motivo: 'Solo la administración puede eliminar personal.' };
        if (id === 'admin' || id === s.usuario_id) return { ok: false, motivo: 'Esa cuenta no se puede eliminar.' };
        const lista = listaUsuariosCruda().filter(u => u.id !== id);
        if (lista.length === listaUsuariosCruda().length) return { ok: false, motivo: 'No se encontró al empleado.' };
        const permisos = leerPermisosPersonal(); delete permisos[id]; escribir(CLAVES.permisosPersonal, permisos);
        const papeles = leer(CLAVES.papeleria, {}) || {}; delete papeles[id]; escribir(CLAVES.papeleria, papeles);
        return guardarListaUsuarios(lista) ? { ok: true } : { ok: false, motivo: 'No se pudo eliminar.' };
    }
    function listarPapeleria(usuarioId) { return ((leer(CLAVES.papeleria, {}) || {})[usuarioId] || []).slice(); }
    function agregarDocumentoPersonal(usuarioId, doc, s) {
        if (!s || !PERMISOS.gestionar_personal.includes(s.rol)) return { ok: false, motivo: 'Solo la administración puede cargar papelería.' };
        if (!USUARIOS[usuarioId]) return { ok: false, motivo: 'No se encontró al empleado.' };
        const titulo = limpiarEspacios(doc.titulo);
        const data = String(doc.data_url || '');
        if (titulo.length < 2 || titulo.length > 80) return { ok: false, motivo: 'Escriba un título de 2 a 80 caracteres.' };
        if (!/^data:(application\/pdf|image\/[a-z0-9.+-]+);base64,/i.test(data)) return { ok: false, motivo: 'Solo se aceptan PDF o imágenes.' };
        if (data.length > 1800000) return { ok: false, motivo: 'El archivo supera 1.2 MB. Use uno más ligero.' };
        const todos = leer(CLAVES.papeleria, {}) || {};
        const lista = todos[usuarioId] || [];
        const registro = { doc_id: uid('DOC'), titulo: titulo, nombre_archivo: limpiarEspacios(doc.nombre_archivo).slice(0, 120) || 'documento', tipo: data.slice(5, data.indexOf(';')), fecha: new Date().toISOString(), data_url: data };
        todos[usuarioId] = lista.concat([registro]);
        return escribir(CLAVES.papeleria, todos) ? { ok: true, documento: { doc_id: registro.doc_id, titulo: registro.titulo, nombre_archivo: registro.nombre_archivo, tipo: registro.tipo, fecha: registro.fecha } } : { ok: false, motivo: 'No se pudo guardar el documento (almacenamiento lleno).' };
    }
    function eliminarDocumentoPersonal(usuarioId, docId, s) {
        if (!s || !PERMISOS.gestionar_personal.includes(s.rol)) return { ok: false, motivo: 'Solo la administración puede eliminar papelería.' };
        const todos = leer(CLAVES.papeleria, {}) || {};
        const lista = todos[usuarioId] || [];
        const siguiente = lista.filter(d => d.doc_id !== docId);
        if (siguiente.length === lista.length) return { ok: false, motivo: 'No se encontró el documento.' };
        todos[usuarioId] = siguiente;
        return escribir(CLAVES.papeleria, todos) ? { ok: true } : { ok: false, motivo: 'No se pudo eliminar.' };
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
            cargos: [],
            cuenta_actual: 0,
            cuenta_actual_total: 0,
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
        return PERSONAL_OPERATIVO.includes(s.rol);
    }
    function filaDe(s, filtro) {
        filtro = filtro || {};
        return ordenarPorLlegada(listarTurnos().filter(t =>
            ESTATUS_EN_FILA.includes(t.estatus) && turnoVisiblePara(t, s) &&
            (!filtro.especialidad_codigo || t.especialidad_codigo === filtro.especialidad_codigo)));
    }
    // PRIVACIDAD (hospitalizados): admin y enfermería ven a todos; un médico solo a sus pacientes (médico tratante)
    // o a los que le hayan solicitado en interconsulta.
    function hospitalizadoVisiblePara(turno, s) {
        if (!s) return false;
        if (s.rol === 'admin' || s.rol === 'administrador' || esEnfermeria(s.rol)) return true;
        if (s.rol === 'medico') {
            if (turno.medico_id === s.medico_id || tieneInterconsulta(turno.turno_id, s.medico_id)) return true;
            return s.especialidad_codigo === 'ANESTESIOLOGIA' && pacienteAsignadoAnestesia(turno, s.medico_id);
        }
        return false;
    }
    function hospitalizadosDe(s) {
        return listarTurnos()
            .filter(t => {
                if (!hospitalizadoVisiblePara(t, s)) return false;
                if (t.estatus === ESTATUS.INTERNADO_EN_PROCESO || t.estatus === ESTATUS.INTERNADO) return true;
                // Tras el alta médica el paciente sale del Monitor de médicos y enfermería de piso;
                // admin y administrador lo siguen viendo (Cuentas por Cobrar / Monitor) hasta el cierre por pago.
                return t.estatus === ESTATUS.ALTA_PENDIENTE_PAGO && (s.rol === 'admin' || s.rol === 'administrador');
            })
            .sort((a, b) => (a.timestamp_llegada < b.timestamp_llegada ? 1 : -1));
    }

    // ---------------------------------------------------------------- FILA INTELIGENTE (cola de espera)
    // La cola de cada médico es un ARREGLO de turnos ordenado por hora de llegada. El número de turno NO se guarda: es la
    // posición dentro del arreglo (1 = el siguiente). Cuando el Turno 1 pasa a consulta sale del arreglo y quien era el
    // Turno 2 pasa a ser el Turno 1 automáticamente. (numero_turno queda como folio histórico del episodio.)
    const ESTATUS_EN_ESPERA = ['pendiente_signos', 'signos_capturados'];
    // Devuelve copias de los turnos en espera con { posicion } calculada sobre la cola COMPLETA del médico (igual para todos los roles).
    function colaEspera(s, filtro) {
        filtro = filtro || {};
        const contador = {};
        return ordenarPorLlegada(listarTurnos().filter(t => ESTATUS_EN_ESPERA.includes(t.estatus)))
            .map(t => { contador[t.medico_id] = (contador[t.medico_id] || 0) + 1; return Object.assign({}, t, { posicion: contador[t.medico_id] }); })
            .filter(t => turnoVisiblePara(t, s) && (!filtro.especialidad_codigo || t.especialidad_codigo === filtro.especialidad_codigo));
    }
    function pacientesEnConsulta(s, filtro) {
        filtro = filtro || {};
        return ordenarPorLlegada(listarTurnos().filter(t => t.estatus === ESTATUS.EN_CONSULTA && turnoVisiblePara(t, s) &&
            (!filtro.especialidad_codigo || t.especialidad_codigo === filtro.especialidad_codigo)));
    }
    function posicionEnCola(turnoId) {
        const t = obtenerTurno(turnoId);
        if (!t) return null;
        const c = colaEspera({ rol: 'admin' }).filter(x => x.medico_id === t.medico_id);
        const k = c.findIndex(x => x.turno_id === turnoId);
        return k >= 0 ? k + 1 : null;
    }
    function posicionNuevaEnCola(medicoId) {
        return listarTurnos().filter(t => ESTATUS_EN_ESPERA.includes(t.estatus) && t.medico_id === medicoId).length + 1;
    }
    function siguienteEnCola(medicoId) {
        return colaEspera({ rol: 'admin' }).find(t => t.medico_id === medicoId) || null;
    }

    // ---------------------------------------------------------------- MÉTRICAS DE 24 HORAS (corte a las 7:00 AM)
    // Corte vigente: hoy 07:00; si todavía no son las 7:00, el corte vigente es el de ayer 07:00.
    function corteDiario(ahora) {
        const d = ahora ? new Date(ahora) : new Date();
        const c = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 7, 0, 0, 0);
        const esHoy = d.getTime() >= c.getTime();
        if (!esHoy) c.setDate(c.getDate() - 1);
        return { fecha: c, iso: c.toISOString(), es_hoy: esHoy, texto: 'Último corte: ' + (esHoy ? 'Hoy' : 'Ayer') + ' 07:00 AM' };
    }
    // Todo es derivable con SQL: turnos con timestamp_llegada >= corte (espera / en consulta) y consultas iniciadas (pase_en) >= corte.
    //  - Pacientes en espera .... llegaron desde el corte y siguen en la cola de espera
    //  - En consulta ............ llegaron desde el corte y están con el médico en este momento
    //  - Consultas totales ...... consultas iniciadas desde el corte (en curso + concluidas, incluye internados y altas)
    function metricas24h(ahora) {
        const corte = corteDiario(ahora), desde = corte.fecha.getTime();
        const turnos = listarTurnos();
        const inicioConsulta = t => Date.parse(t.pase_en || t.timestamp_llegada);
        const llego = t => Date.parse(t.timestamp_llegada) >= desde;
        const consultas = turnos.filter(t => !ESTATUS_EN_ESPERA.includes(t.estatus) && inicioConsulta(t) >= desde);
        const porEsp = ESPECIALIDADES.map((esp, k) => ({ codigo: esp.codigo, nombre: esp.nombre, total: consultas.filter(t => t.especialidad_codigo === esp.codigo).length, orden: k }))
            .filter(x => x.total > 0)                                  // REGLA: solo especialidades con más de 0 consultas
            .sort((a, b) => b.total - a.total || a.orden - b.orden)
            .map(x => ({ codigo: x.codigo, nombre: x.nombre, total: x.total }));
        return {
            corte_iso: corte.iso, corte_texto: corte.texto,
            en_espera: turnos.filter(t => ESTATUS_EN_ESPERA.includes(t.estatus) && llego(t)).length,
            en_consulta: turnos.filter(t => t.estatus === ESTATUS.EN_CONSULTA && llego(t)).length,
            consultas_totales: consultas.length,
            por_especialidad: porEsp
        };
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
        const finalizado = [ESTATUS.INTERNADO, ESTATUS.ALTA, ESTATUS.ALTA_PENDIENTE_PAGO, ESTATUS.CERRADO_HISTORICO].includes(turno.estatus);
        if (s.rol === 'administrador') return { ok: false, motivo: 'Caja y Recepción no accede a expedientes clínicos. Use Cuentas por Cobrar para el cobro.' };
        if (s.rol !== 'admin') {
            // Módulos apagados por el administrador (interruptores de Gestión de Personal)
            const enAtencion = ESTATUS_EN_FILA.includes(turno.estatus);
            if (enAtencion && !permisoModuloDe(s.usuario_id, 'ver_consultas')) return { ok: false, motivo: 'Su perfil no tiene habilitado el módulo de Consultas/Triage.' };
            if (!enAtencion && !permisoModuloDe(s.usuario_id, 'ver_hospitalizados')) return { ok: false, motivo: 'Su perfil no tiene habilitado el módulo de Hospitalizados.' };
        }
        if (s.rol === 'admin') return { ok: true, modo: finalizado ? 'lectura' : 'medico' };
        if (s.rol === 'medico') {
            if (turno.medico_id !== s.medico_id) return { ok: false, motivo: 'Este paciente pertenece a la fila de otro médico. Solo puede ver a sus propios pacientes.' };
            if (ESTATUS_EN_FILA.includes(turno.estatus) && turno.estatus !== ESTATUS.EN_CONSULTA) return { ok: false, motivo: 'Primero inicie la consulta desde su Dashboard (botón "Iniciar Consulta").' };
            if (turno.estatus === ESTATUS.ALTA || turno.estatus === ESTATUS.ALTA_PENDIENTE_PAGO || turno.estatus === ESTATUS.CERRADO_HISTORICO) return { ok: false, motivo: 'La consulta de este paciente ya fue concluida.' };
            return { ok: true, modo: finalizado ? 'lectura' : 'medico' };
        }
        if (esEnfermeria(s.rol)) {
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
        const turnoId = expediente && expediente.meta && expediente.meta.turno_id;
        const clave = x => ((x.meta && x.meta.turno_id) || '') + '|' + ((x.paciente && x.paciente.nombre_completo) || '') + '|' + ((x.consulta && x.consulta.fecha_hora) || '');
        let i = turnoId ? lista.findIndex(x => x && x.meta && x.meta.turno_id === turnoId) : -1;
        if (i < 0) i = lista.findIndex(x => clave(x) === clave(expediente));
        if (i >= 0) {
            const previo = lista[i];
            if (previo && previo.internamiento && !(expediente && expediente.internamiento)) expediente.internamiento = previo.internamiento;
            lista[i] = expediente;
        } else lista.push(expediente);
        return escribir(CLAVES.hospitalizados, lista);
    }

    // ================================================================ INTERNAMIENTOS (hospitalización)
    // Un internamiento nace cuando el médico interna al paciente (estatus internado_en_proceso) y se completa al finalizar el expediente.
    // Los documentos nuevos (notas de evolución, hojas de indicaciones) son INMUTABLES: la capa de datos solo ofrece "agregar",
    // nunca editar ni borrar. Los datos del paciente (nombre, edad, sexo) NO se copian a los documentos: se leen del catálogo
    // al renderizar, por eso una corrección administrativa se refleja en todas las impresiones futuras.
    // Fuente de trabajo: belen_internamientos. Respaldo durable: cada elemento de belen_pacientes_hospitalizados guarda su `internamiento`
    // (se espeja en cada cambio); si la colección faltara, se recupera desde ese arreglo.
    function listarInternamientos() {
        const lista = leer(CLAVES.internamientos, []);
        const ids = new Set(lista.map(x => x.internamiento_id));
        const extra = listarHospitalizados().filter(h => h && h.internamiento && !ids.has(h.internamiento.internamiento_id)).map(h => h.internamiento);
        return extra.length ? lista.concat(extra) : lista;
    }
    // Espeja el internamiento dentro del arreglo belen_pacientes_hospitalizados (crea el elemento si el expediente aún no estaba)
    function espejarEnHospitalizados(i) {
        const lista = listarHospitalizados();
        let h = lista.find(x => x && x.meta && x.meta.turno_id === i.turno_id)
            || lista.find(x => x && x.internamiento && x.internamiento.internamiento_id === i.internamiento_id);
        if (!h) {
            const t = obtenerTurno(i.turno_id) || {};
            const p = buscarPacientePorId(i.paciente_id) || {};
            h = { meta: { esquema_version: '1.0', origen: 'internamiento', turno_id: i.turno_id, paciente_id: i.paciente_id, medico_id: t.medico_id || i.medico_tratante_id,
                          medico_nombre: t.medico_nombre || i.medico_tratante_nombre, especialidad_codigo: t.especialidad_codigo || i.especialidad_codigo },
                 paciente: { nombre_completo: p.nombre_completo || t.paciente_nombre || null, sexo: p.sexo || t.sexo || null, fecha_nacimiento: p.fecha_nacimiento || t.fecha_nacimiento || null } };
            lista.push(h);
        }
        h.internamiento = JSON.parse(JSON.stringify(i));
        return escribir(CLAVES.hospitalizados, lista);
    }
    function internamientoDeTurno(turnoId) { return listarInternamientos().find(x => x.turno_id === turnoId && x.estatus !== 'descartado') || null; }
    function obtenerInternamiento(id) { return listarInternamientos().find(x => x.internamiento_id === id && x.estatus !== 'descartado') || null; }
    function tieneInterconsulta(turnoId, medicoId) {
        const i = internamientoDeTurno(turnoId);
        return !!i && (i.interconsultas || []).some(x => x.medico_id === medicoId);
    }
    function guardarInternamiento(i) {
        const lista = listarInternamientos();
        const k = lista.findIndex(x => x.internamiento_id === i.internamiento_id);
        i.actualizado_en = new Date().toISOString();
        if (k >= 0) lista[k] = i; else lista.push(i);
        if (!escribir(CLAVES.internamientos, lista)) return null;
        espejarEnHospitalizados(i);
        return i;
    }
    function pad3(n) { return String(n).padStart(3, '0'); }
    function fechaHoraLegible(valor) {
        const d = new Date(valor);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleDateString('es-MX') + ' ' + d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    }
    function alergiasDeBorrador(turnoId) {
        const b = leerBorrador(turnoId);
        const c = (b && b.campos) || {};
        return (c['chk-alergias'] && c['val-alergias']) ? limpiarEspacios(c['val-alergias']) : null;
    }
    function textoDiagnosticos(datos, turno) {
        const lista = ((datos && datos.diagnosticos) || []).map(d => ((d.cie10_codigo ? d.cie10_codigo + ' ' : '') + (d.descripcion || '')).trim()).filter(Boolean);
        if (!lista.length && turno && turno.dx_principal) lista.push(turno.dx_principal);
        return lista.join('; ') || null;
    }
    function textosIndicaciones(ind) {
        const t = k => String(((ind || {})[k] || {}).texto || '').trim();
        return { dieta: t('dieta'), soluciones_parenterales: t('soluciones_parenterales'), medicamentos: t('medicamentos'), medidas_generales: t('medidas_generales') };
    }
    function nuevaHojaIndicaciones(hojas, origen, textos, autor, fechaHora) {
        return Object.assign({
            hoja_id: uid('IM'), folio: 'IM-' + pad3(hojas.length + 1), fecha_hora: fechaHora || new Date().toISOString(), fecha_dia: hoyLocal(), origen: origen,
            autor_id: autor.id, autor_nombre: autor.nombre, relacion: autor.relacion
        }, textos);
    }

    // Crea o actualiza el internamiento de un turno. datos = expediente exportado (construirExpediente); extra = { finalizado, snapshot }
    function sincronizarInternamiento(turnoId, datos, extra) {
        const t = obtenerTurno(turnoId);
        if (!t) return null;
        datos = datos || {}; extra = extra || {};
        let i = listarInternamientos().find(x => x.turno_id === turnoId && x.estatus !== 'descartado');
        if (!i) {
            i = { internamiento_id: uid('INT'), turno_id: turnoId, paciente_id: t.paciente_id, medico_tratante_id: t.medico_id, medico_tratante_nombre: t.medico_nombre,
                  especialidad_codigo: t.especialidad_codigo, especialidad: t.especialidad, fecha_ingreso: new Date().toISOString(), cama: null, estatus: 'activo',
                  interconsultas: [], notas_evolucion: [], hojas_indicaciones: [], cargos: [], cuenta_actual: 0, cuenta_actual_total: 0, nota_egreso: null };
        }
        const estatusCerrado = i.estatus === ESTATUS.ALTA_PENDIENTE_PAGO || i.estatus === ESTATUS.CERRADO_HISTORICO
            || t.estatus === ESTATUS.ALTA_PENDIENTE_PAGO || t.estatus === ESTATUS.CERRADO_HISTORICO;
        if (!estatusCerrado) i.estatus = 'activo';
        const al = ((datos.antecedentes || {}).personales_patologicos || {}).alergias;
        if (al) i.alergias = (al.presente && al.descripcion) ? limpiarEspacios(al.descripcion) : null;
        else if (i.alergias === undefined) i.alergias = alergiasDeBorrador(turnoId);
        i.diagnostico_ingreso = textoDiagnosticos(datos, t) || i.diagnostico_ingreso || null;
        if (!(i.notas_evolucion || []).length) i.diagnostico_actual = i.diagnostico_ingreso;
        i.destino = (datos.consulta && datos.consulta.destino) || t.destino || null;
        i.area_destino = (datos.ingreso && datos.ingreso.area_destino && datos.ingreso.area_destino.descripcion) || t.area_destino || null;
        if (!estatusCerrado) {
            const ya = new Set((i.cargos || []).map(c => c.cargo_id));
            const extraCargos = (t.cargos || []).filter(c => c && c.cargo_id && !ya.has(c.cargo_id));
            if (extraCargos.length) {
                i.cargos = (i.cargos || []).concat(extraCargos);
                i.cuenta_actual = totalCargos(i.cargos);
                i.cuenta_actual_total = i.cuenta_actual;
            }
        }
        let hojaParaFarmacia = null, previaParaFarmacia = null;
        if (extra.finalizado) {
            i.finalizado_en = new Date().toISOString();
            if (extra.snapshot) i.snapshot_formulario = extra.snapshot;
            if (datos.indicaciones) {
                const textos = textosIndicaciones(datos.indicaciones);
                const hojas = i.hojas_indicaciones || [];
                const primera = hojas.find(h => h.origen === 'ingreso');
                const autor = { id: t.medico_id, nombre: t.medico_nombre, relacion: 'tratante' };
                if (!primera) {
                    hojaParaFarmacia = nuevaHojaIndicaciones([], 'ingreso', textos, autor, (datos.consulta && datos.consulta.fecha_hora) || null);
                    i.hojas_indicaciones = hojas;
                    i.hojas_indicaciones.unshift(hojaParaFarmacia);
                } else if (hojas.length === 1) {
                    previaParaFarmacia = { medicamentos: primera.medicamentos, soluciones_parenterales: primera.soluciones_parenterales };
                    Object.assign(primera, textos);
                    hojaParaFarmacia = primera;
                }
            }
        }
        const guardadoInternamiento = guardarInternamiento(i);
        if (guardadoInternamiento && hojaParaFarmacia) encolarSurtidoIndicacion(guardadoInternamiento, hojaParaFarmacia, previaParaFarmacia);
        return guardadoInternamiento;
    }
    // Reconstruye el internamiento de un turno ya hospitalizado que aún no lo tuviera (datos anteriores a este módulo)
    function asegurarInternamiento(turnoId) {
        const ya = internamientoDeTurno(turnoId);
        if (ya) return ya;
        const t = obtenerTurno(turnoId);
        if (!t || (t.estatus !== ESTATUS.INTERNADO_EN_PROCESO && t.estatus !== ESTATUS.INTERNADO)) return null;
        const visita = listarVisitas().find(v => v.meta && v.meta.turno_id === turnoId) || null;
        const final = t.estatus === ESTATUS.INTERNADO;
        return sincronizarInternamiento(turnoId, visita, { finalizado: final && !!visita, snapshot: final ? leerBorrador(turnoId) : null });
    }
    // Acepta internamiento_id o turno_id
    function resolverInternamiento(id) {
        return obtenerInternamiento(id) || (obtenerTurno(id) ? asegurarInternamiento(id) : null);
    }
    function descartarInternamiento(turnoId) {
        const lista = listarInternamientos();
        const i = lista.find(x => x.turno_id === turnoId && x.estatus !== 'descartado');
        if (!i) return false;
        i.estatus = 'descartado'; i.actualizado_en = new Date().toISOString();
        const ok = escribir(CLAVES.internamientos, lista);
        espejarEnHospitalizados(i);
        return ok;
    }

    // Tarjeta del Monitor de Camas
    function relacionMedico(i, turno, s) {
        if (!s || s.rol !== 'medico' || !turno) return null;
        if (turno.medico_id === s.medico_id) return 'tratante';
        return ((i && i.interconsultas) || []).some(x => x.medico_id === s.medico_id) ? 'interconsultante' : null;
    }
    function fichaHospitalizado(turno, s) {
        const i = internamientoDeTurno(turno.turno_id);
        const p = buscarPacientePorId(turno.paciente_id) || { nombre_completo: turno.paciente_nombre, fecha_nacimiento: turno.fecha_nacimiento, sexo: turno.sexo };
        return {
            turno_id: turno.turno_id, internamiento_id: i ? i.internamiento_id : null, paciente_id: turno.paciente_id,
            nombre: p.nombre_completo, edad: calcularEdad(p.fecha_nacimiento), sexo: p.sexo,
            cama: i ? i.cama : null,
            alergias: i && i.alergias !== undefined ? i.alergias : alergiasDeBorrador(turno.turno_id),
            medico_tratante_id: turno.medico_id, medico_tratante: turno.medico_nombre, especialidad: turno.especialidad,
            diagnostico_actual: (i && i.diagnostico_actual) || turno.dx_principal || null,
            interconsultas: i ? (i.interconsultas || []) : [],
            notas: i ? (i.notas_evolucion || []).length : 0,
            estatus: turno.estatus, finalizado: turno.estatus === ESTATUS.INTERNADO,
            pendiente_pago: turno.estatus === ESTATUS.ALTA_PENDIENTE_PAGO,
            cuenta_actual: i ? Number(i.cuenta_actual || 0) : Number(turno.cuenta_actual || 0),
            area: (i && i.area_destino) || turno.area_destino || null, destino: (i && i.destino) || turno.destino || null,
            relacion: relacionMedico(i, turno, s)
        };
    }

    // Quién puede abrir el visor expediente.html?modo=hospitalizado&turno=... (también acepta internamiento_id)
    function accesoVisorHospitalizado(s, i) {
        if (!s) return { ok: false, motivo: 'Inicie sesión para continuar.' };
        if (!i) return { ok: false, motivo: 'No se encontró el internamiento solicitado.' };
        const t = obtenerTurno(i.turno_id);
        if (!t) return { ok: false, motivo: 'No se encontró el episodio del paciente.' };
        const caja = s.rol === 'administrador' && (PERMISOS.cargar_consumos.includes(s.rol) || PERMISOS.ver_cuentas_cobrar.includes(s.rol));
        if (s.rol !== 'admin' && !caja && !permisoModuloDe(s.usuario_id, 'ver_hospitalizados')) return { ok: false, motivo: 'Su perfil no tiene habilitado el módulo de Hospitalizados.' };
        if (!hospitalizadoVisiblePara(t, s)) return { ok: false, motivo: 'Este paciente no está a su cargo ni le fue solicitado en interconsulta. Solo puede ver a sus propios pacientes hospitalizados.' };
        const visorOk = t.estatus === ESTATUS.INTERNADO || t.estatus === ESTATUS.ALTA_PENDIENTE_PAGO || t.estatus === ESTATUS.CERRADO_HISTORICO;
        if (!visorOk) return { ok: false, motivo: 'El papeleo de ingreso de este paciente sigue en curso. El visor se habilita cuando el médico finaliza el expediente.' };
        if (t.estatus === ESTATUS.CERRADO_HISTORICO && s.rol !== 'admin' && s.rol !== 'medico') {
            return { ok: false, motivo: 'Este expediente está cerrado. Solo se consulta en Búsqueda Histórica.' };
        }
        const relacion = relacionMedico(i, t, s) || s.rol;
        const activo = t.estatus === ESTATUS.INTERNADO;
        const veCuenta = s.rol === 'admin' || s.rol === 'administrador' || esEnfermeria(s.rol);
        return { ok: true, relacion: relacion,
                 puede_escribir: activo && s.rol === 'medico' && (relacion === 'tratante' || relacion === 'interconsultante'),
                 puede_dar_alta: activo && s.rol === 'medico' && relacion === 'tratante',
                 puede_cargar_cuenta: activo && permisoAccionDe(s.usuario_id, 'cargar_consumos'),
                 puede_ver_cuenta: veCuenta,
                 puede_corregir: activo && !!PERMISOS.corregir_datos_paciente.includes(s.rol), turno: t };
    }
    function puedeEscribirInternamiento(s, i) {
        const a = accesoVisorHospitalizado(s, i);
        return a.ok && a.puede_escribir;
    }

    // ---- Interconsulta: otorga permiso inmediato al especialista (no imprime nada)
    function medicosParaInterconsulta(i, codigoEspecialidad) {
        const t = obtenerTurno(i.turno_id);
        const ya = new Set((i.interconsultas || []).map(x => x.medico_id));
        return medicosDeEspecialidad(codigoEspecialidad).filter(m => m.medico_id !== (t && t.medico_id) && !ya.has(m.medico_id));
    }
    function solicitarInterconsulta(internamientoId, datos, s) {
        const i = obtenerInternamiento(internamientoId);
        if (!i || !puedeEscribirInternamiento(s, i)) return { ok: false, motivo: 'No tiene permiso para solicitar interconsultas de este paciente.' };
        const esp = especialidadPorCodigo(datos.especialidad_codigo);
        const m = USUARIOS[datos.medico_id];
        if (!esp) return { ok: false, motivo: 'Seleccione la especialidad.' };
        if (!m || m.rol !== 'medico' || m.especialidad_codigo !== esp.codigo) return { ok: false, motivo: 'Seleccione un médico de esa especialidad.' };
        if (m.medico_id === s.medico_id) return { ok: false, motivo: 'No puede solicitarse una interconsulta a sí mismo.' };
        if (m.medico_id === i.medico_tratante_id) return { ok: false, motivo: 'Ese médico ya es el médico tratante del paciente.' };
        if ((i.interconsultas || []).some(x => x.medico_id === m.medico_id)) return { ok: false, motivo: 'Ese médico ya tiene acceso a este paciente.' };
        const ic = { interconsulta_id: uid('IC'), especialidad_codigo: esp.codigo, especialidad: esp.nombre, medico_id: m.medico_id, medico_nombre: m.nombre,
                     solicitada_por_id: s.usuario_id, solicitada_por_nombre: s.nombre, solicitada_en: new Date().toISOString() };
        i.interconsultas = (i.interconsultas || []).concat([ic]);
        return guardarInternamiento(i) ? { ok: true, interconsulta: ic } : { ok: false, motivo: 'No se pudo guardar (almacenamiento lleno o bloqueado).' };
    }

    // ---- Notas de evolución (documentos inmutables)
    function contarLetrasTxt(t) { return (String(t || '').match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) || []).length; }
    // Formato SOAP: Subjetivo, Objetivo (signos vitales de hoy + exploración física), Análisis y Plan; diagnóstico opcional.
    // entrada: { subjetivo, signos_vitales:{campo:valor}, exploracion_fisica, analisis, plan, diagnostico_actualizado }
    // Errores de signos: clave 'sv_<campo>'.
    function validarNotaEvolucion(entrada) {
        const sv = validarSignos(entrada.signos_vitales || {});
        const v = {
            subjetivo: String(entrada.subjetivo || '').trim(), exploracion_fisica: String(entrada.exploracion_fisica || '').trim(),
            analisis: String(entrada.analisis || '').trim(), plan: String(entrada.plan || '').trim(), diagnostico_actualizado: limpiarEspacios(entrada.diagnostico_actualizado)
        };
        const errores = {};
        if (contarLetrasTxt(v.subjetivo) < 10) errores.subjetivo = 'Describa lo que refiere el paciente (mínimo 10 letras).';
        Object.keys(sv.errores).forEach(c => { if (SIGNOS_OBLIGATORIOS.includes(c) || sv.valores[c] !== null) errores['sv_' + c] = sv.errores[c]; });
        if (contarLetrasTxt(v.exploracion_fisica) < 5) errores.exploracion_fisica = 'Registre la exploración física.';
        if (contarLetrasTxt(v.analisis) < 10) errores.analisis = 'Escriba el análisis clínico (mínimo 10 letras).';
        if (contarLetrasTxt(v.plan) < 5) errores.plan = 'Escriba el plan a seguir.';
        if (v.diagnostico_actualizado && contarLetrasTxt(v.diagnostico_actualizado) < 3) errores.diagnostico_actualizado = 'Escriba el diagnóstico completo o déjelo vacío si no cambió.';
        const signos = {};
        SIGNOS_OBLIGATORIOS.concat(['peso_kg', 'talla_m']).forEach(c => { signos[c] = sv.valores[c] === undefined ? null : sv.valores[c]; });
        return { ok: Object.keys(errores).length === 0, errores: errores,
                 valores: { subjetivo: v.subjetivo, objetivo: { signos_vitales: signos, exploracion_fisica: v.exploracion_fisica }, analisis: v.analisis, plan: v.plan, diagnostico_actualizado: v.diagnostico_actualizado || null } };
    }
    function agregarNotaEvolucion(internamientoId, entrada, s) {
        const i = obtenerInternamiento(internamientoId);
        if (!i || !puedeEscribirInternamiento(s, i)) return { ok: false, motivo: 'Solo el médico tratante o interconsultado puede agregar notas de evolución.' };
        const r = validarNotaEvolucion(entrada);
        if (!r.ok) return { ok: false, motivo: 'Revise los campos marcados.', errores: r.errores };
        const t = obtenerTurno(i.turno_id);
        const relacion = relacionMedico(i, t, s);
        const ic = (i.interconsultas || []).find(x => x.medico_id === s.medico_id);
        const nota = Object.assign({
            nota_id: uid('EV'), folio: 'EV-' + pad3((i.notas_evolucion || []).length + 1), formato: 'SOAP', fecha_hora: new Date().toISOString(),
            autor_id: s.usuario_id, autor_nombre: s.nombre, autor_especialidad: s.especialidad || null, relacion: relacion,
            interconsulta_especialidad: relacion === 'interconsultante' && ic ? ic.especialidad : null
        }, r.valores);
        nota.diagnostico_vigente = r.valores.diagnostico_actualizado || i.diagnostico_actual || i.diagnostico_ingreso || null;   // el diagnóstico que rige al firmar la nota
        i.notas_evolucion = (i.notas_evolucion || []).concat([nota]);
        if (r.valores.diagnostico_actualizado) i.diagnostico_actual = r.valores.diagnostico_actualizado;
        return guardarInternamiento(i) ? { ok: true, nota: nota } : { ok: false, motivo: 'No se pudo guardar (almacenamiento lleno o bloqueado).' };
    }

    // ---- Indicaciones médicas: cada modificación genera una hoja nueva; la última es la vigente
    function indicacionesVigentes(i) { const h = (i && i.hojas_indicaciones) || []; return h.length ? h[h.length - 1] : null; }
    function agregarHojaIndicaciones(internamientoId, entrada, s) {
        const i = obtenerInternamiento(internamientoId);
        if (!i || !puedeEscribirInternamiento(s, i)) return { ok: false, motivo: 'Solo el médico tratante o interconsultado puede modificar las indicaciones.' };
        const textos = {};
        ['dieta', 'soluciones_parenterales', 'medicamentos', 'medidas_generales'].forEach(k => { textos[k] = String(entrada[k] || '').trim(); });
        if (!Object.values(textos).some(Boolean)) return { ok: false, motivo: 'Capture al menos una indicación.' };
        const vig = indicacionesVigentes(i);
        if (vig && Object.keys(textos).every(k => String(vig[k] || '').trim() === textos[k])) return { ok: false, sin_cambios: true, motivo: 'No hay cambios respecto a las indicaciones vigentes.' };
        const t = obtenerTurno(i.turno_id);
        const hoja = nuevaHojaIndicaciones(i.hojas_indicaciones || [], 'actualizacion', textos, { id: s.usuario_id, nombre: s.nombre, relacion: relacionMedico(i, t, s) });
        i.hojas_indicaciones = (i.hojas_indicaciones || []).concat([hoja]);
        if (!guardarInternamiento(i)) return { ok: false, motivo: 'No se pudo guardar (almacenamiento lleno o bloqueado).' };
        encolarSurtidoIndicacion(i, hoja, vig);
        return { ok: true, hoja: hoja };
    }

    // ---- Cama (la asigna Enfermería o Administración desde el Monitor de Camas)
    function asignarCama(turnoId, cama, s) {
        if (!s || !permisoAccionDe(s.usuario_id, 'asignar_cama')) return { ok: false, motivo: 'Su perfil no puede asignar camas.' };
        const texto = limpiarEspacios(cama);
        if (texto.length < 1 || texto.length > 40 || !/^[\p{L}\p{N} .,:·#\-\/]+$/u.test(texto)) return { ok: false, motivo: 'Escriba una cama válida (letras, números, comas y guiones; máximo 40 caracteres).' };
        const i = asegurarInternamiento(turnoId);
        if (!i) return { ok: false, motivo: 'El paciente no está hospitalizado.' };
        const ocupada = listarInternamientos().find(x => x.internamiento_id !== i.internamiento_id && x.estatus === 'activo' && normalizar(x.cama) === normalizar(texto)
            && ['internado', 'internado_en_proceso'].includes((obtenerTurno(x.turno_id) || {}).estatus));
        if (ocupada) { const o = obtenerTurno(ocupada.turno_id); return { ok: false, motivo: `La cama "${texto}" ya está ocupada por ${o ? o.paciente_nombre : 'otro paciente'}.` }; }
        i.cama = texto;
        return guardarInternamiento(i) ? { ok: true, internamiento: i } : { ok: false, motivo: 'No se pudo guardar (almacenamiento lleno o bloqueado).' };
    }

    // ---- Cuenta, cargos, nota de egreso y cierre de caja
    const CONCEPTOS_HOSPITAL = [
        'Ceftriaxona 1g', 'Noche de Hospitalización', 'Consulta Especialista', 'Solución fisiológica 1000 ml',
        'Paracetamol 1g intravenoso', 'Curación', 'Material de sutura', 'Oxígeno por hora', 'Electrocardiograma'
    ];
    const CONCEPTOS_AMBULATORIO = [
        'Inyección', 'Curación', 'Material', 'Consulta', 'Nebulización', 'Electrocardiograma', 'Aplicación intramuscular'
    ];
    function formatoMoneda(n) {
        return Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
    }
    function totalCargos(cargos) {
        return (cargos || []).reduce((s, c) => s + Number(c.subtotal || 0), 0);
    }
    function validarCargo(entrada) {
        const concepto = limpiarEspacios(entrada.concepto);
        const crudo = String(entrada.precio_unitario === undefined || entrada.precio_unitario === null ? '' : entrada.precio_unitario).trim().replace(',', '.');
        const errores = {};
        if (concepto.length < 2 || concepto.length > 80) errores.concepto = 'Escriba el concepto (2 a 80 caracteres).';
        const n = Number(crudo);
        if (!Number.isFinite(n) || n < 0.01 || n > 999999.99) errores.precio_unitario = 'Indique un precio entre $0.01 y $999,999.99.';
        const precio = Math.round(n * 100) / 100;
        const aplica = entrada.aplica_iva === true || entrada.aplica_iva === 'true' || entrada.aplica_iva === '1';
        return { ok: Object.keys(errores).length === 0, errores: errores, valores: { concepto: concepto, precio_unitario: precio, cantidad: 1, subtotal: precio, aplica_iva: aplica } };
    }
    function nuevoCargo(valores, origen, s) {
        return {
            cargo_id: uid('CG'), concepto: valores.concepto, precio_unitario: valores.precio_unitario, cantidad: 1, subtotal: valores.subtotal,
            aplica_iva: !!valores.aplica_iva,
            origen: origen, cargado_por_id: s.usuario_id, cargado_por_nombre: s.nombre, cargado_en: new Date().toISOString()
        };
    }
    function puedeCargarConsumos(s, i) {
        if (!s || !i || !permisoAccionDe(s.usuario_id, 'cargar_consumos')) return false;
        const t = obtenerTurno(i.turno_id);
        return !!t && t.estatus === ESTATUS.INTERNADO;
    }
    function agregarCargoInternamiento(internamientoId, entrada, s) {
        const i = obtenerInternamiento(internamientoId);
        if (!i) return { ok: false, motivo: 'No se encontró el internamiento.' };
        if (!puedeCargarConsumos(s, i)) return { ok: false, motivo: 'Solo se pueden cargar consumos mientras el internamiento está activo.' };
        const r = validarCargo(entrada);
        if (!r.ok) return { ok: false, motivo: 'Revise los campos marcados.', errores: r.errores };
        i.cargos = (i.cargos || []).concat([nuevoCargo(r.valores, 'hospitalizacion', s)]);
        i.cuenta_actual = totalCargos(i.cargos);
        i.cuenta_actual_total = i.cuenta_actual;
        return guardarInternamiento(i) ? { ok: true, cargo: i.cargos[i.cargos.length - 1], internamiento: i } : { ok: false, motivo: 'No se pudo guardar (almacenamiento lleno o bloqueado).' };
    }
    function agregarCargoTurno(turnoId, entrada, s) {
        if (!s || !PERMISOS.cargar_cuenta_consulta.includes(s.rol)) return { ok: false, motivo: 'Su perfil no puede cargar conceptos a la cuenta de consulta.' };
        const t = obtenerTurno(turnoId);
        if (!t) return { ok: false, motivo: 'No se encontró el episodio.' };
        if (t.estatus !== ESTATUS.EN_CONSULTA) return { ok: false, motivo: 'Solo se pueden cargar conceptos durante la consulta.' };
        if (s.rol === 'medico' && t.medico_id !== s.medico_id) return { ok: false, motivo: 'Solo el médico de este paciente puede cargar conceptos.' };
        const r = validarCargo(entrada);
        if (!r.ok) return { ok: false, motivo: 'Revise los campos marcados.', errores: r.errores };
        const cargos = (t.cargos || []).concat([nuevoCargo(r.valores, 'ambulatorio', s)]);
        const total = totalCargos(cargos);
        const actualizado = actualizarTurno(turnoId, { cargos: cargos, cuenta_actual: total, cuenta_actual_total: total });
        if (!actualizado) return { ok: false, motivo: 'No se pudo guardar.' };
        encolarSurtidoConsulta(actualizado, cargos[cargos.length - 1]);
        return { ok: true, cargo: cargos[cargos.length - 1], turno: actualizado };
    }
    function validarNotaEgreso(entrada) {
        const v = {
            motivo_egreso: String(entrada.motivo_egreso || '').trim(), resumen_clinico: String(entrada.resumen_clinico || '').trim(),
            diagnostico_final: String(entrada.diagnostico_final || '').trim(), pronostico: String(entrada.pronostico || '').trim(),
            plan_alta: String(entrada.plan_alta || '').trim()
        };
        const errores = {};
        if (contarLetrasTxt(v.motivo_egreso) < 5) errores.motivo_egreso = 'Indique el motivo de egreso.';
        if (contarLetrasTxt(v.resumen_clinico) < 15) errores.resumen_clinico = 'Escriba el resumen clínico (mínimo 15 letras).';
        if (contarLetrasTxt(v.diagnostico_final) < 5) errores.diagnostico_final = 'Indique el diagnóstico final.';
        if (contarLetrasTxt(v.pronostico) < 5) errores.pronostico = 'Indique el pronóstico.';
        if (contarLetrasTxt(v.plan_alta) < 5) errores.plan_alta = 'Indique el plan de alta.';
        return { ok: Object.keys(errores).length === 0, errores: errores, valores: v };
    }
    function registrarEgreso(internamientoId, entrada, s) {
        const i = obtenerInternamiento(internamientoId);
        if (!i) return { ok: false, motivo: 'No se encontró el internamiento.' };
        const t = obtenerTurno(i.turno_id);
        if (!s || !t) return { ok: false, motivo: 'No se pudo validar la sesión.' };
        if (!PERMISOS.dar_alta_hospital.includes(s.rol) || relacionMedico(i, t, s) !== 'tratante') return { ok: false, motivo: 'Solo el médico tratante puede dar de alta al paciente.' };
        if (t.estatus !== ESTATUS.INTERNADO) return { ok: false, motivo: 'El paciente no está en un internamiento activo.' };
        if (i.nota_egreso) return { ok: false, motivo: 'Ya existe una nota de egreso para este internamiento.' };
        const r = validarNotaEgreso(entrada);
        if (!r.ok) return { ok: false, motivo: 'Revise los campos marcados.', errores: r.errores };
        const nota = Object.assign({
            nota_id: uid('EG'), folio: 'EG-001', tipo: 'nota_egreso', fecha_hora: new Date().toISOString(),
            autor_id: s.usuario_id, autor_nombre: s.nombre, autor_especialidad: s.especialidad || null, relacion: 'tratante'
        }, r.valores);
        i.nota_egreso = nota;
        i.diagnostico_actual = r.valores.diagnostico_final;
        i.estatus = ESTATUS.ALTA_PENDIENTE_PAGO;
        i.egreso_en = nota.fecha_hora;
        i.cuenta_actual = totalCargos(i.cargos);
        i.cuenta_actual_total = i.cuenta_actual;
        if (!guardarInternamiento(i)) return { ok: false, motivo: 'No se pudo guardar (almacenamiento lleno o bloqueado).' };
        actualizarTurno(t.turno_id, { estatus: ESTATUS.ALTA_PENDIENTE_PAGO, dx_principal: r.valores.diagnostico_final, cuenta_actual: i.cuenta_actual, cuenta_actual_total: i.cuenta_actual });
        return { ok: true, internamiento: obtenerInternamiento(i.internamiento_id), nota: nota };
    }
    function cargosDeEpisodio(turno) {
        const i = internamientoDeTurno(turno.turno_id);
        const deInternamiento = (i && i.cargos) || [];
        if (!i) return turno.cargos || [];
        const ya = new Set(deInternamiento.map(c => c.cargo_id));
        return deInternamiento.concat((turno.cargos || []).filter(c => c && c.cargo_id && !ya.has(c.cargo_id)));
    }
    function cuentasPorCobrar(s) {
        if (!s || !PERMISOS.ver_cuentas_cobrar.includes(s.rol)) return [];
        return listarTurnos()
            .filter(t => t.estatus === ESTATUS.ALTA_PENDIENTE_PAGO)
            .sort((a, b) => String(b.actualizado_en || b.timestamp_llegada).localeCompare(String(a.actualizado_en || a.timestamp_llegada)));
    }
    function fichaCuenta(turno) {
        const p = buscarPacientePorId(turno.paciente_id) || { nombre_completo: turno.paciente_nombre, fecha_nacimiento: turno.fecha_nacimiento, sexo: turno.sexo };
        const i = internamientoDeTurno(turno.turno_id);
        const cargos = cargosDeEpisodio(turno);
        const total = totalCargos(cargos);
        return {
            turno_id: turno.turno_id, internamiento_id: i ? i.internamiento_id : null, paciente_id: turno.paciente_id,
            nombre: p.nombre_completo, edad: calcularEdad(p.fecha_nacimiento), sexo: p.sexo,
            medico_nombre: turno.medico_nombre, especialidad: turno.especialidad,
            origen: i ? 'hospitalizacion' : 'ambulatorio', cama: i ? i.cama : null,
            diagnostico: (i && (i.diagnostico_actual || i.diagnostico_ingreso)) || turno.dx_principal || null,
            cargos: cargos, total: total, cuenta_actual: total, cuenta_actual_total: total, estatus: turno.estatus,
            egreso_en: (i && i.egreso_en) || turno.actualizado_en || null
        };
    }
    function cerrarExpedientePagado(turnoId, s, opciones) {
        if (!s || !PERMISOS.cerrar_expediente_pago.includes(s.rol)) return { ok: false, motivo: 'Solo Administración puede cerrar el expediente por pago.' };
        const t = obtenerTurno(turnoId);
        if (!t) return { ok: false, motivo: 'No se encontró el episodio.' };
        if (t.estatus !== ESTATUS.ALTA_PENDIENTE_PAGO) return { ok: false, motivo: 'Este expediente no está pendiente de pago.' };
        const ahora = new Date().toISOString();
        const fiscal = desgloseFiscal(cargosDeEpisodio(t), !!(opciones && opciones.requirio_factura));
        const pago = { requirio_factura: fiscal.requirio_factura, iva_cobrado: fiscal.iva, total_pagado: fiscal.total, subtotal_base: fiscal.subtotal };
        const cerrado = actualizarTurno(turnoId, Object.assign({ estatus: ESTATUS.CERRADO_HISTORICO, cerrado_en: ahora, cerrado_por_id: s.usuario_id, cerrado_por_nombre: s.nombre }, pago));
        const i = internamientoDeTurno(turnoId);
        if (i) { i.estatus = ESTATUS.CERRADO_HISTORICO; i.cerrado_en = ahora; Object.assign(i, pago); guardarInternamiento(i); }
        const visitas = listarVisitas();
        const vi = visitas.findIndex(v => v.meta && v.meta.turno_id === turnoId);
        if (vi >= 0) {
            visitas[vi].meta = Object.assign({}, visitas[vi].meta, { estatus_episodio: ESTATUS.CERRADO_HISTORICO, cerrado_en: ahora });
            escribir(CLAVES.visitas, visitas);
        }
        return { ok: true, turno: cerrado };
    }

    // ---- Corrección administrativa de datos del paciente (nombre, edad y sexo)
    function fechaNacimientoParaEdad(fnActual, edad, ref) {
        const hoy = ref || new Date();
        const base = parseFechaISO(fnActual) || new Date(hoy.getFullYear(), 0, 1);
        const mes = base.getMonth(), dia = base.getDate();
        const cumplido = hoy.getMonth() > mes || (hoy.getMonth() === mes && hoy.getDate() >= dia);
        const anio = hoy.getFullYear() - edad - (cumplido ? 0 : 1);
        let f = new Date(anio, mes, dia);
        if (f.getMonth() !== mes) f = new Date(anio, mes, 28);   // 29 de febrero en año no bisiesto
        return f.getFullYear() + '-' + String(f.getMonth() + 1).padStart(2, '0') + '-' + String(f.getDate()).padStart(2, '0');
    }
    function validarCorreccionPaciente(entrada) {
        const v = { nombre: limpiarEspacios(entrada.nombre), edad: String(entrada.edad === undefined || entrada.edad === null ? '' : entrada.edad).trim(), sexo: entrada.sexo,
                    fecha_nacimiento: entrada.fecha_nacimiento };
        const errores = {};
        if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'.\- ]{5,}$/.test(v.nombre) || v.nombre.split(' ').filter(w => w.length > 1).length < 2) errores.nombre = 'Escriba nombre y apellido (solo letras).';
        const e = Number(v.edad);
        if (v.edad === '' || !Number.isInteger(e) || e < 0 || e > 120) errores.edad = 'Escriba la edad en años (0 a 120).';
        if (v.sexo !== 'F' && v.sexo !== 'M') errores.sexo = 'Seleccione el sexo.';
        // F. Nacimiento (opcional para compatibilidad: si falta, se deriva de la edad). Si viene, debe ser coherente con la edad.
        if (v.fecha_nacimiento !== undefined) {
            if (!parseFechaISO(v.fecha_nacimiento)) errores.fecha_nacimiento = 'Seleccione la fecha de nacimiento.';
            else if (v.fecha_nacimiento > hoyLocal() || v.fecha_nacimiento < '1900-01-01') errores.fecha_nacimiento = 'La fecha de nacimiento no es válida.';
            else if (!errores.edad && calcularEdad(v.fecha_nacimiento) !== e) errores.edad = 'La edad no coincide con la fecha de nacimiento (' + calcularEdad(v.fecha_nacimiento) + ' años).';
        }
        return { ok: Object.keys(errores).length === 0, errores: errores, valores: { nombre: v.nombre, edad: e, sexo: v.sexo, fecha_nacimiento: v.fecha_nacimiento } };
    }
    // Cambia el catálogo y TODAS las copias del paciente (turnos, visitas, hospitalizados, borradores). Los documentos del
    // internamiento no guardan estos datos: se renderizan desde el catálogo, así que reflejan el cambio de inmediato.
    function corregirDatosPaciente(pacienteId, entrada, s) {
        if (!s || !PERMISOS.corregir_datos_paciente.includes(s.rol)) return { ok: false, motivo: 'Solo la administración puede corregir datos del paciente.' };
        const r = validarCorreccionPaciente(entrada);
        if (!r.ok) return { ok: false, motivo: 'Revise los campos marcados.', errores: r.errores };
        const cat = listarPacientes();
        const p = cat.find(x => x.paciente_id === pacienteId);
        if (!p) return { ok: false, motivo: 'No se encontró el paciente.' };
        const edadActual = calcularEdad(p.fecha_nacimiento);
        const nuevaFN = r.valores.fecha_nacimiento || ((edadActual === r.valores.edad) ? p.fecha_nacimiento : fechaNacimientoParaEdad(p.fecha_nacimiento, r.valores.edad));
        const choque = cat.find(x => x.paciente_id !== pacienteId && normalizar(x.nombre_completo) === normalizar(r.valores.nombre) && x.fecha_nacimiento === nuevaFN);
        if (choque) return { ok: false, motivo: 'Ya existe otro expediente con ese nombre y esa fecha de nacimiento (' + choque.paciente_id + ').', errores: { nombre: 'Coincide con el expediente ' + choque.paciente_id + '.' } };

        const antes = { nombre: p.nombre_completo, edad: edadActual, sexo: p.sexo, fecha_nacimiento: p.fecha_nacimiento };
        p.nombre_completo = r.valores.nombre; p.sexo = r.valores.sexo; p.fecha_nacimiento = nuevaFN; p.actualizado_en = new Date().toISOString();
        escribir(CLAVES.catalogo, cat);

        const turnos = listarTurnos();
        turnos.forEach(t => { if (t.paciente_id === pacienteId) { t.paciente_nombre = r.valores.nombre; t.sexo = r.valores.sexo; t.fecha_nacimiento = nuevaFN; } });
        escribir(CLAVES.turnos, turnos);

        const aplicarEnExpediente = e => {
            if (!e || !e.meta || e.meta.paciente_id !== pacienteId) return;
            e.paciente = e.paciente || {};
            e.paciente.nombre_completo = r.valores.nombre; e.paciente.sexo = r.valores.sexo; e.paciente.fecha_nacimiento = nuevaFN;
            const f = e.consulta && e.consulta.fecha_hora ? new Date(e.consulta.fecha_hora) : null;
            e.paciente.edad_anios = calcularEdad(nuevaFN, f && !isNaN(f.getTime()) ? f : new Date());
        };
        const visitas = listarVisitas(); visitas.forEach(aplicarEnExpediente); escribir(CLAVES.visitas, visitas);
        const hosp = listarHospitalizados(); hosp.forEach(aplicarEnExpediente); escribir(CLAVES.hospitalizados, hosp);

        const borradores = leer(CLAVES.borradores, {}) || {};
        turnos.filter(t => t.paciente_id === pacienteId).forEach(t => {
            const b = borradores[t.turno_id];
            if (!b) return;
            b.paciente = r.valores.nombre;
            if (b.campos && 'comp-fn' in b.campos) b.campos['comp-fn'] = nuevaFN;
        });
        escribir(CLAVES.borradores, borradores);

        const bitacora = leer(CLAVES.correcciones, []);
        const ahora = new Date().toISOString();
        const asiento = (campo, a, d) => { if (String(a) !== String(d)) bitacora.push({ correccion_id: uid('COR'), paciente_id: pacienteId, campo: campo, antes: a, despues: d, por_id: s.usuario_id, por_nombre: s.nombre, en: ahora }); };
        asiento('nombre_completo', antes.nombre, r.valores.nombre); asiento('edad_anios', antes.edad, r.valores.edad); asiento('sexo', antes.sexo, r.valores.sexo);
        if (antes.fecha_nacimiento !== nuevaFN) asiento('fecha_nacimiento', antes.fecha_nacimiento, nuevaFN);
        escribir(CLAVES.correcciones, bitacora);
        return { ok: true, paciente: p, antes: antes };
    }

    // ================================================================ CIRUGÍAS PROGRAMADAS
    // Estructura (tabla SQL futura): cirugia_id PK, paciente_id FK opcional, paciente_nombre, fecha_nacimiento, procedimiento,
    // fecha_hora (ISO), medico_cirujano_id FK, medico_cirujano_nombre, notas, estatus (programada | realizada | cancelada).
    // Si la cirugía está ligada a un paciente del catálogo, nombre y fecha de nacimiento se leen del catálogo (reflejan correcciones).
    function listarCirugias() { return leer(CLAVES.cirugias, []); }
    function fichaCirugia(c) {
        const p = c.paciente_id ? buscarPacientePorId(c.paciente_id) : null;
        const nombre = p ? p.nombre_completo : c.paciente_nombre, fn = p ? p.fecha_nacimiento : c.fecha_nacimiento;
        const m = USUARIOS[c.medico_cirujano_id];
        const a = USUARIOS[c.anestesiologo_id];
        const d = new Date(c.fecha_hora);
        const valida = !isNaN(d.getTime());
        return {
            cirugia_id: c.cirugia_id, paciente_id: c.paciente_id || null, nombre: nombre, fecha_nacimiento: fn, edad: calcularEdad(fn),
            procedimiento: c.procedimiento, fecha_hora: c.fecha_hora, estatus: c.estatus,
            fecha_texto: valida ? d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '',
            hora_texto: valida ? d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '',
            medico_cirujano_id: c.medico_cirujano_id, medico_cirujano: m ? m.nombre : c.medico_cirujano_nombre,
            medico_especialidad: m ? m.cargo : null,
            anestesiologo_id: c.anestesiologo_id || null, anestesiologo: a ? a.nombre : (c.anestesiologo_nombre || ''),
            notas: c.notas || ''
        };
    }
    function pacienteAsignadoAnestesia(turno, medicoId) {
        if (!turno || !medicoId) return false;
        return listarCirugias().some(c => c.estatus !== 'cancelada' && c.anestesiologo_id === medicoId && (
            (c.paciente_id && c.paciente_id === turno.paciente_id) || normalizar(c.paciente_nombre) === normalizar(turno.paciente_nombre)));
    }
    function cirugiaVisiblePara(c, s) {
        if (!s || !c) return false;
        if (s.rol !== 'medico') return true;
        if (c.medico_cirujano_id === s.medico_id || c.anestesiologo_id === s.medico_id) return true;
        if (s.especialidad_codigo === 'ANESTESIOLOGIA' || !c.paciente_id) return false;
        return listarInternamientos().some(i => i.paciente_id === c.paciente_id && i.estatus !== 'descartado' && (i.interconsultas || []).some(x => x.medico_id === s.medico_id));
    }
    function cirugiasVisibles(s, ahora) {
        return proximasCirugias(ahora).filter(c => cirugiaVisiblePara(c, s));
    }
    // Próximas = programadas con fecha y hora de hoy en adelante (más cercana primero)
    function proximasCirugias(ahora) {
        const t0 = (ahora ? new Date(ahora) : new Date()).getTime();
        return listarCirugias().filter(c => c.estatus === 'programada' && Date.parse(c.fecha_hora) >= t0)
            .sort((a, b) => Date.parse(a.fecha_hora) - Date.parse(b.fecha_hora)).map(fichaCirugia);
    }
    function cirujanos() { return medicosActivos().filter(u => u.especialidad_codigo !== 'ANESTESIOLOGIA'); }
    function anestesiologos() { return medicosDeEspecialidad('ANESTESIOLOGIA'); }
    // entrada.fecha_hora: 'YYYY-MM-DDTHH:mm' (hora local del navegador)
    function validarCirugia(entrada, ahora) {
        const v = {
            nombre: limpiarEspacios(entrada.nombre), fecha_nacimiento: entrada.fecha_nacimiento || '', procedimiento: limpiarEspacios(entrada.procedimiento),
            fecha_hora: entrada.fecha_hora || '', medico_cirujano_id: entrada.medico_cirujano_id || '', anestesiologo_id: entrada.anestesiologo_id || '', notas: String(entrada.notas || '').trim()
        };
        const errores = {};
        if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'.\- ]{5,}$/.test(v.nombre) || v.nombre.split(' ').filter(w => w.length > 1).length < 2) errores.nombre = 'Escriba el nombre completo (nombre y apellido, solo letras).';
        if (!parseFechaISO(v.fecha_nacimiento)) errores.fecha_nacimiento = 'Seleccione la fecha de nacimiento.';
        else if (v.fecha_nacimiento > hoyLocal() || v.fecha_nacimiento < '1900-01-01') errores.fecha_nacimiento = 'La fecha de nacimiento no es válida.';
        if (contarLetrasTxt(v.procedimiento) < 4) errores.procedimiento = 'Escriba el nombre de la cirugía.';
        const d = new Date(v.fecha_hora);
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v.fecha_hora) || isNaN(d.getTime())) errores.fecha_hora = 'Seleccione la fecha y la hora exacta de la cirugía.';
        else if (d.getTime() < (ahora ? new Date(ahora) : new Date()).getTime()) errores.fecha_hora = 'La fecha y la hora deben ser posteriores al momento actual.';
        const m = USUARIOS[v.medico_cirujano_id];
        const an = USUARIOS[v.anestesiologo_id];
        if (!m || m.rol !== 'medico' || m.activo === false) errores.medico_cirujano_id = 'Seleccione al médico cirujano.';
        if (!an || an.rol !== 'medico' || an.activo === false || an.especialidad_codigo !== 'ANESTESIOLOGIA') errores.anestesiologo_id = 'Seleccione al anestesiólogo.';
        else if (an.id === (m && m.id)) errores.anestesiologo_id = 'El anestesiólogo debe ser distinto del cirujano.';
        if (v.notas.length > 600) errores.notas = 'Máximo 600 caracteres.';
        return { ok: Object.keys(errores).length === 0, errores: errores, valores: v };
    }
    function programarCirugia(entrada, s) {
        if (!s || !permisoAccionDe(s.usuario_id, 'programar_cirugia')) return { ok: false, motivo: 'Su perfil no puede programar cirugías.' };
        const r = validarCirugia(entrada);
        if (!r.ok) return { ok: false, motivo: 'Revise los campos marcados.', errores: r.errores };
        const v = r.valores, m = USUARIOS[v.medico_cirujano_id], an = USUARIOS[v.anestesiologo_id];
        const pac = buscarPacientePorIdentidad(v.nombre, v.fecha_nacimiento);
        const c = {
            cirugia_id: uid('CX'), paciente_id: pac ? pac.paciente_id : null, paciente_nombre: pac ? pac.nombre_completo : v.nombre, fecha_nacimiento: v.fecha_nacimiento,
            procedimiento: v.procedimiento, fecha_hora: new Date(v.fecha_hora).toISOString(), medico_cirujano_id: m.id, medico_cirujano_nombre: m.nombre,
            anestesiologo_id: an.id, anestesiologo_nombre: an.nombre,
            notas: v.notas, estatus: 'programada', programada_por_id: s.usuario_id, programada_por_nombre: s.nombre, creado_en: new Date().toISOString()
        };
        const lista = listarCirugias().concat([c]);
        return escribir(CLAVES.cirugias, lista) ? { ok: true, cirugia: c } : { ok: false, motivo: 'No se pudo guardar (almacenamiento lleno o bloqueado).' };
    }
    // Datos de demostración (fechas relativas a hoy, para que siempre sean "próximas")
    function sembrarCirugiasSiHaceFalta() {
        if (localStorage.getItem(CLAVES.cirugias) !== null) return false;
        const base = new Date();
        const cuando = (dias, h, min) => { const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + dias, h, min, 0, 0); return d.toISOString(); };
        const pronto = new Date(base.getTime() + 3 * 3600000); pronto.setMinutes(pronto.getMinutes() < 30 ? 30 : 60, 0, 0);
        const enCatalogo = id => !!buscarPacientePorId(id);
        const lista = [
            { paciente_id: enCatalogo('PAC-000001') ? 'PAC-000001' : null, paciente_nombre: 'Carlos Ruiz Herrera', fecha_nacimiento: '1979-03-14', procedimiento: 'Colecistectomía laparoscópica',
              fecha_hora: pronto.toISOString(), medico_cirujano_id: 'dr_arturo', notas: 'Ayuno de 8 horas confirmado. Alergia a penicilina: avisar al anestesiólogo.' },
            { paciente_id: null, paciente_nombre: 'María Fernández Lozano', fecha_nacimiento: '1984-02-09', procedimiento: 'Safenectomía de miembro inferior derecho',
              fecha_hora: cuando(1, 8, 0), medico_cirujano_id: 'dr_roberto', notas: 'Prefiere anestesia regional. Pendiente pago del deducible.' },
            { paciente_id: enCatalogo('PAC-000002') ? 'PAC-000002' : null, paciente_nombre: 'Laura Méndez Olvera', fecha_nacimiento: '1991-07-22', procedimiento: 'Hernioplastía umbilical',
              fecha_hora: cuando(2, 10, 30), medico_cirujano_id: 'dr_arturo', notas: 'Valoración preanestésica pendiente. Acompañante: esposo.' },
            { paciente_id: null, paciente_nombre: 'Héctor Salas Mejía', fecha_nacimiento: '1962-11-30', procedimiento: 'Creación de fístula arteriovenosa en antebrazo',
              fecha_hora: cuando(4, 13, 0), medico_cirujano_id: 'dr_roberto', notas: 'Paciente en hemodiálisis. Requiere cama en hospitalización posterior.' }
        ].map((c, k) => Object.assign({
            cirugia_id: 'CX-DEMO-' + (k + 1), medico_cirujano_nombre: USUARIOS[c.medico_cirujano_id].nombre,
            anestesiologo_id: 'dra_elena', anestesiologo_nombre: (USUARIOS.dra_elena || {}).nombre || 'Dra. Elena Ríos',
            estatus: 'programada', programada_por_id: 'administrador', programada_por_nombre: USUARIOS.administrador.nombre, creado_en: new Date().toISOString()
        }, c));
        return escribir(CLAVES.cirugias, lista);
    }
    function completarAnestesiologoCirugias() {
        const ana = USUARIOS.dra_elena;
        if (!ana) return false;
        const lista = listarCirugias();
        let cambio = false;
        lista.forEach(c => {
            if (!c.anestesiologo_id) { c.anestesiologo_id = ana.id; c.anestesiologo_nombre = ana.nombre; cambio = true; }
            if (!c.medico_cirujano_nombre && USUARIOS[c.medico_cirujano_id]) { c.medico_cirujano_nombre = USUARIOS[c.medico_cirujano_id].nombre; cambio = true; }
        });
        return cambio ? escribir(CLAVES.cirugias, lista) : false;
    }

    // ---------------------------------------------------------------- Farmacia: inventario por lote y cola de surtido
    function listarFarmacia() { return leer(CLAVES.farmacia, []); }
    function listarSurtido() { return leer(CLAVES.surtido, []); }
    function puedeGestionarFarmacia(s) { return !!s && permisoAccionDe(s.usuario_id, 'gestionar_farmacia'); }
    function puedeVerFarmacia(s) { return !!s && permisoModuloDe(s.usuario_id, 'ver_farmacia'); }
    function isoMasDias(dias) {
        const d = parseFechaISO(hoyLocal());
        d.setDate(d.getDate() + dias);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function compactarNombre(t) { return normalizar(t).replace(/\s+/g, ''); }
    function textoFarmacia(hoja) {
        return [hoja && hoja.medicamentos, hoja && hoja.soluciones_parenterales].map(x => String(x || '').trim()).filter(Boolean).join('\n');
    }
    function parsearLineasSurtido(texto) {
        const trozos = String(texto || '').split(/[\n;]+/).map(s => s.trim()).filter(Boolean);
        const planos = [];
        trozos.forEach(t => {
            if (/\d+\s*[xX×]\s+/.test(t) && t.indexOf(',') >= 0) t.split(',').map(s => s.trim()).filter(Boolean).forEach(p => planos.push(p));
            else planos.push(t);
        });
        const mapa = [];
        planos.forEach(p => {
            const m = p.match(/^(\d+)\s*[xX×]\s+(.+)$/);
            const cantidad = m ? Math.min(99, parseInt(m[1], 10)) : 1;
            const nombre = limpiarEspacios(m ? m[2] : p).replace(/[.,]$/, '');
            if (!nombre || nombre.length < 2 || !Number.isFinite(cantidad) || cantidad < 1) return;
            const ya = mapa.find(x => normalizar(x.nombre) === normalizar(nombre));
            if (ya) ya.cantidad += cantidad; else mapa.push({ nombre: nombre, cantidad: cantidad });
        });
        return mapa;
    }
    function diferenciaLineas(nuevas, viejas) {
        const resto = {};
        (viejas || []).forEach(l => { const k = normalizar(l.nombre); resto[k] = (resto[k] || 0) + l.cantidad; });
        const out = [];
        (nuevas || []).forEach(l => {
            const k = normalizar(l.nombre);
            const ya = resto[k] || 0;
            if (l.cantidad > ya) out.push({ nombre: l.nombre, cantidad: l.cantidad - ya });
            resto[k] = Math.max(0, ya - l.cantidad);
        });
        return out;
    }
    function puntajeLinea(linea, producto) {
        if (linea.sku && normalizar(linea.sku) === normalizar(producto.sku)) return 100;
        const a = compactarNombre(linea.nombre), b = compactarNombre(producto.nombre);
        if (!a || !b) return 0;
        if (a === b) return 90;
        if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return 70 + Math.min(a.length, b.length);
        const token = normalizar(producto.nombre).split(' ').find(w => w.length >= 6);
        return token && normalizar(linea.nombre).indexOf(token) >= 0 ? 40 : 0;
    }
    function sugerirSku(linea) {
        if (linea.sku) return linea.sku;
        let mejor = null, pts = 0;
        const vistos = {};
        listarFarmacia().forEach(prod => {
            if (vistos[prod.sku]) return;
            vistos[prod.sku] = true;
            const p = puntajeLinea(linea, prod);
            if (p > pts) { pts = p; mejor = prod.sku; }
        });
        return pts >= 40 ? mejor : null;
    }
    function nuevaLineaSurtido(base) {
        return {
            linea_id: uid('LN'), nombre: base.nombre, cantidad: base.cantidad, cantidad_surtida: 0, estatus: 'pendiente',
            sku: base.sku || null, cargo_id: base.cargo_id || null, facturado: !!base.facturado
        };
    }
    function guardarSolicitud(sol) {
        const cola = listarSurtido();
        cola.unshift(sol);
        return escribir(CLAVES.surtido, cola) ? sol : null;
    }
    function encolarSurtidoIndicacion(i, hoja, previa) {
        const actual = textoFarmacia(hoja);
        if (normalizar(actual) === normalizar(textoFarmacia(previa))) return null;
        const nuevas = parsearLineasSurtido(actual);
        const cola = listarSurtido();
        const abiertas = cola.filter(s => s.estatus === 'pendiente' && s.origen === 'indicacion' && s.internamiento_id === i.internamiento_id);
        const intactas = abiertas.length > 0 && abiertas.every(s => s.lineas.every(l => !(l.cantidad_surtida > 0)));
        if (intactas) {
            abiertas.forEach(s => { s.estatus = 'reemplazada'; });
            if (!nuevas.length) return escribir(CLAVES.surtido, cola) ? null : null;
            const sol = {
                solicitud_id: uid('SR'), estatus: 'pendiente', origen: 'indicacion', hoja_id: hoja.hoja_id,
                turno_id: i.turno_id, internamiento_id: i.internamiento_id, paciente_id: i.paciente_id, cama: i.cama || null,
                creada_en: new Date().toISOString(), lineas: nuevas.map(nuevaLineaSurtido)
            };
            cola.unshift(sol);
            return escribir(CLAVES.surtido, cola) ? sol : null;
        }
        const delta = diferenciaLineas(nuevas, parsearLineasSurtido(textoFarmacia(previa)));
        if (!delta.length) return null;
        return guardarSolicitud({
            solicitud_id: uid('SR'), estatus: 'pendiente', origen: 'indicacion', hoja_id: hoja.hoja_id,
            turno_id: i.turno_id, internamiento_id: i.internamiento_id, paciente_id: i.paciente_id, cama: i.cama || null,
            creada_en: new Date().toISOString(), lineas: delta.map(nuevaLineaSurtido)
        });
    }
    function encolarSurtidoConsulta(turno, cargo) {
        if (!turno || !cargo) return null;
        return guardarSolicitud({
            solicitud_id: uid('SR'), estatus: 'pendiente', origen: 'consulta', hoja_id: null,
            turno_id: turno.turno_id, internamiento_id: null, paciente_id: turno.paciente_id, cama: null,
            creada_en: new Date().toISOString(),
            lineas: [nuevaLineaSurtido({ nombre: cargo.concepto, cantidad: cargo.cantidad || 1, cargo_id: cargo.cargo_id, facturado: true })]
        });
    }
    function diasParaCaducar(iso) {
        const cad = parseFechaISO(iso), hoy = parseFechaISO(hoyLocal());
        if (!cad || !hoy) return null;
        return Math.round((cad.getTime() - hoy.getTime()) / 86400000);
    }
    const CATEGORIAS_FARMACIA = [
        { codigo: 'MEDICAMENTO', nombre: 'Medicamento' },
        { codigo: 'MATERIAL_CURACION', nombre: 'Material de curación' },
        { codigo: 'LABORATORIO', nombre: 'Laboratorio' },
        { codigo: 'IMAGENOLOGIA', nombre: 'Imagenología' },
        { codigo: 'PROCEDIMIENTO', nombre: 'Procedimiento' }
    ];
    const FRACCIONES_COFEPRIS = [
        { codigo: 'I', nombre: 'I · Estupefaciente' },
        { codigo: 'II', nombre: 'II · Psicotrópico' },
        { codigo: 'III', nombre: 'III · Psicotrópico' },
        { codigo: 'IV_ANTIBIOTICO', nombre: 'IV · Antibiótico' },
        { codigo: 'IV', nombre: 'IV' },
        { codigo: 'V', nombre: 'V' },
        { codigo: 'VI', nombre: 'VI · Venta libre' },
        { codigo: 'NA', nombre: 'No aplica' }
    ];
    const FRACCIONES_RECETA = ['II', 'III', 'IV_ANTIBIOTICO'];
    const CATEGORIAS_FISICAS = ['MEDICAMENTO', 'MATERIAL_CURACION'];
    const FORMAS_FARMACEUTICAS = [
        { codigo: 'TABLETA', nombre: 'Tableta' },
        { codigo: 'CAPSULA', nombre: 'Cápsula' },
        { codigo: 'SOLUCION_INYECTABLE', nombre: 'Solución Inyectable / Ámpula' },
        { codigo: 'SUSPENSION', nombre: 'Suspensión' },
        { codigo: 'FRASCO', nombre: 'Frasco / Ampolleta' },
        { codigo: 'MATERIAL', nombre: 'Material de Curación' },
        { codigo: 'ESTUDIO', nombre: 'Estudio / Servicio' }
    ];
    const VIAS_ADMINISTRACION = [
        { codigo: 'VO', nombre: 'VO' }, { codigo: 'IV', nombre: 'IV' }, { codigo: 'IM', nombre: 'IM' },
        { codigo: 'SC', nombre: 'SC' }, { codigo: 'TOPICA', nombre: 'Tópica' }, { codigo: 'INHALADA', nombre: 'Inhalada' },
        { codigo: 'NA', nombre: 'N/A' }
    ];
    const CONSERVACIONES = [
        { codigo: 'AMBIENTE', nombre: 'Ambiente (<30°C)' },
        { codigo: 'REFRIGERACION', nombre: 'Refrigeración (2°C-8°C)' }
    ];
    const LABORATORIOS_FRECUENTES = ['Pisa', 'Pfizer', 'Bayer', 'Sanofi', 'Roche', 'AstraZeneca', 'Sophía', 'B. Braun'];
    const FEUM_SKU = {
        'CEF-1G': { forma_farmaceutica: 'SOLUCION_INYECTABLE', concentracion: '1 g', via_administracion: 'IV', conservacion: 'AMBIENTE', proveedor: 'Casa Saba' },
        'SOL-1000': { forma_farmaceutica: 'FRASCO', concentracion: '1000 ml', via_administracion: 'IV', conservacion: 'AMBIENTE', proveedor: 'Casa Saba' },
        'FIS-1000': { forma_farmaceutica: 'FRASCO', concentracion: '1000 ml', via_administracion: 'IV', conservacion: 'AMBIENTE', proveedor: 'Casa Saba' },
        'PAR-1G': { forma_farmaceutica: 'SOLUCION_INYECTABLE', concentracion: '1 g', via_administracion: 'IV', conservacion: 'AMBIENTE', proveedor: 'Casa Saba' },
        'FEN-50': { nombre_comercial: 'Fenodid', forma_farmaceutica: 'SOLUCION_INYECTABLE', concentracion: '0.5 mg / 10 ml', via_administracion: 'IV', conservacion: 'AMBIENTE', proveedor: 'Casa Saba' },
        'DIA-10': { nombre_comercial: 'Valium', forma_farmaceutica: 'TABLETA', concentracion: '10 mg', via_administracion: 'VO', conservacion: 'AMBIENTE', proveedor: 'Nadro' },
        'GUA-M': { forma_farmaceutica: 'MATERIAL', via_administracion: 'NA', conservacion: 'AMBIENTE', proveedor: 'Dimsa' },
        'JER-10': { forma_farmaceutica: 'MATERIAL', via_administracion: 'NA', conservacion: 'AMBIENTE', proveedor: 'Dimsa' },
        'VEN-18': { forma_farmaceutica: 'MATERIAL', via_administracion: 'NA', conservacion: 'AMBIENTE', proveedor: 'Casa Saba' },
        'PUN-18': { forma_farmaceutica: 'MATERIAL', via_administracion: 'NA', conservacion: 'AMBIENTE', proveedor: 'Dimsa' },
        'CUR-01': { forma_farmaceutica: 'MATERIAL', via_administracion: 'NA', conservacion: 'AMBIENTE' },
        'MAT-01': { forma_farmaceutica: 'MATERIAL', via_administracion: 'NA', conservacion: 'AMBIENTE' },
        'SUT-01': { forma_farmaceutica: 'MATERIAL', via_administracion: 'NA', conservacion: 'AMBIENTE', proveedor: 'Dimsa' },
        'EKG-01': { forma_farmaceutica: 'ESTUDIO', via_administracion: 'NA', conservacion: 'AMBIENTE' },
        'DEX-01': { forma_farmaceutica: 'ESTUDIO', via_administracion: 'NA', conservacion: 'AMBIENTE', proveedor: 'Nadro' },
        'LAB-BH': { forma_farmaceutica: 'ESTUDIO', via_administracion: 'NA', conservacion: 'AMBIENTE' },
        'RX-ABD': { forma_farmaceutica: 'ESTUDIO', via_administracion: 'NA', conservacion: 'AMBIENTE' },
        'INY-01': { forma_farmaceutica: 'ESTUDIO', via_administracion: 'IM', conservacion: 'AMBIENTE' },
        'CON-01': { forma_farmaceutica: 'ESTUDIO', via_administracion: 'NA', conservacion: 'AMBIENTE' },
        'NEB-01': { forma_farmaceutica: 'ESTUDIO', via_administracion: 'INHALADA', conservacion: 'AMBIENTE' },
        'IM-01': { forma_farmaceutica: 'ESTUDIO', via_administracion: 'IM', conservacion: 'AMBIENTE' }
    };
    const META_SKU_FARMACIA = {
        'CEF-1G': { laboratorio: 'Pisa', categoria: 'MEDICAMENTO', fraccion_cofepris: 'IV_ANTIBIOTICO', piezas_por_caja: 1, aplica_iva: false },
        'SOL-1000': { laboratorio: 'Pisa', categoria: 'MEDICAMENTO', fraccion_cofepris: 'VI', piezas_por_caja: 1, aplica_iva: false },
        'FIS-1000': { laboratorio: 'Pisa', categoria: 'MEDICAMENTO', fraccion_cofepris: 'VI', piezas_por_caja: 1, aplica_iva: false },
        'PAR-1G': { laboratorio: 'Pisa', categoria: 'MEDICAMENTO', fraccion_cofepris: 'VI', piezas_por_caja: 1, aplica_iva: false },
        'INY-01': { laboratorio: 'Sanatorio Belén', categoria: 'PROCEDIMIENTO', fraccion_cofepris: 'NA', piezas_por_caja: 1, aplica_iva: true },
        'CUR-01': { laboratorio: 'Genérico', categoria: 'MATERIAL_CURACION', fraccion_cofepris: 'NA', piezas_por_caja: 1, aplica_iva: true },
        'MAT-01': { laboratorio: 'Genérico', categoria: 'MATERIAL_CURACION', fraccion_cofepris: 'NA', piezas_por_caja: 1, aplica_iva: true },
        'SUT-01': { laboratorio: 'Ethicon', categoria: 'MATERIAL_CURACION', fraccion_cofepris: 'NA', piezas_por_caja: 1, aplica_iva: true },
        'CON-01': { laboratorio: 'Sanatorio Belén', categoria: 'PROCEDIMIENTO', fraccion_cofepris: 'NA', piezas_por_caja: 1, aplica_iva: true },
        'NEB-01': { laboratorio: 'Sanatorio Belén', categoria: 'PROCEDIMIENTO', fraccion_cofepris: 'NA', piezas_por_caja: 1, aplica_iva: true },
        'EKG-01': { laboratorio: 'Sanatorio Belén', categoria: 'PROCEDIMIENTO', fraccion_cofepris: 'NA', piezas_por_caja: 1, aplica_iva: true },
        'IM-01': { laboratorio: 'Sanatorio Belén', categoria: 'PROCEDIMIENTO', fraccion_cofepris: 'NA', piezas_por_caja: 1, aplica_iva: true },
        'FEN-50': { laboratorio: 'Pisa', categoria: 'MEDICAMENTO', fraccion_cofepris: 'I', piezas_por_caja: 5, aplica_iva: false },
        'DIA-10': { laboratorio: 'Roche', categoria: 'MEDICAMENTO', fraccion_cofepris: 'II', piezas_por_caja: 1, aplica_iva: false },
        'GUA-M': { laboratorio: 'Ambiderm', categoria: 'MATERIAL_CURACION', fraccion_cofepris: 'NA', piezas_por_caja: 1, aplica_iva: true },
        'JER-10': { laboratorio: 'BD', categoria: 'MATERIAL_CURACION', fraccion_cofepris: 'NA', piezas_por_caja: 1, aplica_iva: true },
        'VEN-18': { laboratorio: 'Pisa', categoria: 'MATERIAL_CURACION', fraccion_cofepris: 'NA', piezas_por_caja: 1, aplica_iva: true },
        'PUN-18': { laboratorio: 'BD', categoria: 'MATERIAL_CURACION', fraccion_cofepris: 'NA', piezas_por_caja: 1, aplica_iva: true },
        'LAB-BH': { laboratorio: 'Laboratorio Belén', categoria: 'LABORATORIO', fraccion_cofepris: 'NA', piezas_por_caja: 1, aplica_iva: true },
        'RX-ABD': { laboratorio: 'Imagen Belén', categoria: 'IMAGENOLOGIA', fraccion_cofepris: 'NA', piezas_por_caja: 1, aplica_iva: true },
        'DEX-01': { laboratorio: 'Roche', categoria: 'PROCEDIMIENTO', fraccion_cofepris: 'NA', piezas_por_caja: 1, aplica_iva: true }
    };

    function redondearMoneda(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
    function precioConIvaDe(precio, aplica) {
        const base = redondearMoneda(precio);
        return aplica ? redondearMoneda(base * 1.16) : base;
    }
    function montosProducto(p, cantidad) {
        const cant = cantidad || 1;
        const base = redondearMoneda(p.precio_unitario);
        return { precio_unitario: base, aplica_iva: !!p.aplica_iva, cantidad: cant, subtotal: redondearMoneda(base * cant), iva_unitario: 0, iva_total: 0 };
    }
    function desgloseFiscal(cargos, conFactura) {
        const lista = cargos || [];
        const subtotal = redondearMoneda(lista.reduce((s, c) => s + Number(c.subtotal || 0), 0));
        const baseGravable = redondearMoneda(lista.reduce((s, c) => s + (c && c.aplica_iva ? Number(c.subtotal || 0) : 0), 0));
        const iva = conFactura ? redondearMoneda(baseGravable * 0.16) : 0;
        return { subtotal: subtotal, base_gravable: baseGravable, iva: iva, total: redondearMoneda(subtotal + iva), requirio_factura: !!conFactura };
    }
    function codigoDeLista(lista, valor, fallback) { return lista.some(x => x.codigo === valor) ? valor : fallback; }
    function formaPorCategoria(categoria) {
        if (categoria === 'MATERIAL_CURACION') return 'MATERIAL';
        if (categoria === 'LABORATORIO' || categoria === 'IMAGENOLOGIA' || categoria === 'PROCEDIMIENTO') return 'ESTUDIO';
        return 'TABLETA';
    }
    function completarLote(p) {
        const meta = Object.assign({}, META_SKU_FARMACIA[p.sku] || {}, FEUM_SKU[p.sku] || {});
        const categoria = CATEGORIAS_FARMACIA.some(c => c.codigo === p.categoria) ? p.categoria : (meta.categoria || 'MEDICAMENTO');
        const fraccion = FRACCIONES_COFEPRIS.some(f => f.codigo === p.fraccion_cofepris) ? p.fraccion_cofepris : (meta.fraccion_cofepris || 'NA');
        const aplica = typeof p.aplica_iva === 'boolean' ? p.aplica_iva : (typeof meta.aplica_iva === 'boolean' ? meta.aplica_iva : categoria !== 'MEDICAMENTO');
        const piezas = parseInt(p.piezas_por_caja, 10);
        const base = redondearMoneda(p.precio_unitario);
        return Object.assign({}, p, {
            nombre_comercial: limpiarEspacios(p.nombre_comercial || meta.nombre_comercial || ''),
            laboratorio: limpiarEspacios(p.laboratorio || meta.laboratorio || 'Sin laboratorio'),
            proveedor: limpiarEspacios(p.proveedor || meta.proveedor || ''),
            numero_factura: limpiarEspacios(p.numero_factura || ''),
            forma_farmaceutica: codigoDeLista(FORMAS_FARMACEUTICAS, p.forma_farmaceutica, meta.forma_farmaceutica || formaPorCategoria(categoria)),
            concentracion: limpiarEspacios(p.concentracion || meta.concentracion || ''),
            via_administracion: codigoDeLista(VIAS_ADMINISTRACION, p.via_administracion, meta.via_administracion || 'NA'),
            conservacion: codigoDeLista(CONSERVACIONES, p.conservacion, meta.conservacion || 'AMBIENTE'),
            categoria: categoria, fraccion_cofepris: fraccion,
            piezas_por_caja: Number.isInteger(piezas) && piezas > 0 ? piezas : (meta.piezas_por_caja || 1),
            aplica_iva: aplica, precio_con_iva: precioConIvaDe(base, aplica), precio_unitario: base
        });
    }
    function nombreFormaFarmaceutica(codigo) { const f = FORMAS_FARMACEUTICAS.find(x => x.codigo === codigo); return f ? f.nombre : (codigo || ''); }
    function nombreConservacion(codigo) { const c = CONSERVACIONES.find(x => x.codigo === codigo); return c ? c.nombre : (codigo || ''); }
    function textoStockFarmacia(p) {
        const piezas = p.piezas_por_caja > 0 ? p.piezas_por_caja : 1;
        const cajas = Math.floor((p.stock || 0) / piezas);
        const sueltas = (p.stock || 0) % piezas;
        let eq = cajas + (cajas === 1 ? ' caja' : ' cajas') + ' de ' + piezas;
        if (sueltas) eq += ' + ' + sueltas + (sueltas === 1 ? ' suelta' : ' sueltas');
        return { piezas: (p.stock || 0) + ' pzas', cajas: eq };
    }
    function denominacionProducto(p) {
        if (!p) return '';
        return p.nombre_comercial ? p.nombre + ' (' + p.nombre_comercial + ')' : p.nombre;
    }
    function nombreCategoriaFarmacia(codigo) { const c = CATEGORIAS_FARMACIA.find(x => x.codigo === codigo); return c ? c.nombre : codigo || ''; }
    function nombreFraccionCofepris(codigo) { const f = FRACCIONES_COFEPRIS.find(x => x.codigo === codigo); return f ? f.nombre : (codigo || 'No aplica'); }
    function esInsumoFisico(p) { return !!p && CATEGORIAS_FISICAS.indexOf(p.categoria) >= 0; }
    function etiquetaNormativa(fraccion) {
        if (fraccion === 'I') return 'Estupefaciente · Fracción I. Cada ámpula se justifica con receta individual ligada a la receta especial de la caja.';
        if (fraccion === 'IV_ANTIBIOTICO') return 'Requiere Receta Retenida / Sellada - Fracción IV (antibiótico)';
        if (fraccion === 'II' || fraccion === 'III') return 'Requiere Receta Retenida / Sellada - Fracción ' + fraccion;
        return '';
    }
    function fichaNormativa(p, dosis) {
        return {
            sku: p.sku, nombre: p.nombre, fraccion: p.fraccion_cofepris, etiqueta: etiquetaNormativa(p.fraccion_cofepris),
            laboratorio: p.laboratorio, lote: p.lote, retenida: FRACCIONES_RECETA.indexOf(p.fraccion_cofepris) >= 0,
            estupefaciente: p.fraccion_cofepris === 'I', dosis: dosis || p.nombre
        };
    }

    function listarInventarioFarmacia(s) {
        if (!puedeVerFarmacia(s)) return [];
        return listarFarmacia().map(p => {
            const dias = diasParaCaducar(p.caducidad);
            return Object.assign({}, p, { dias_caducidad: dias, alerta: p.stock < 5 || (dias !== null && dias < 30) });
        }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es') || String(a.caducidad).localeCompare(String(b.caducidad)));
    }
    function productoPorSku(codigo) {
        const n = normalizar(codigo);
        const lotes = listarFarmacia().filter(p => normalizar(p.sku) === n);
        if (!lotes.length) return null;
        return lotes.slice().sort((a, b) => b.stock - a.stock || String(a.caducidad).localeCompare(String(b.caducidad)))[0];
    }
    function buscarLotesFarmacia(texto) {
        const n = normalizar(texto);
        if (n.length < 2) return [];
        return listarFarmacia().filter(p => p.stock > 0 && String(p.caducidad) >= hoyLocal() && (normalizar(p.sku).indexOf(n) >= 0 || normalizar(p.nombre).indexOf(n) >= 0 || normalizar(p.nombre_comercial).indexOf(n) >= 0 || normalizar(p.lote).indexOf(n) >= 0))
            .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es') || String(a.caducidad).localeCompare(String(b.caducidad))).slice(0, 12);
    }
    function validarIngresoFarmacia(entrada) {
        const sku = limpiarEspacios(entrada.sku).toUpperCase();
        const nombre = limpiarEspacios(entrada.nombre);
        const nombreComercial = limpiarEspacios(entrada.nombre_comercial);
        const laboratorio = limpiarEspacios(entrada.laboratorio);
        const proveedor = limpiarEspacios(entrada.proveedor);
        const factura = limpiarEspacios(entrada.numero_factura).toUpperCase();
        const categoria = String(entrada.categoria || '').trim();
        const forma = String(entrada.forma_farmaceutica || '').trim();
        const concentracion = limpiarEspacios(entrada.concentracion);
        const via = String(entrada.via_administracion || 'NA').trim();
        const conservacion = String(entrada.conservacion || 'AMBIENTE').trim();
        const fraccion = String(entrada.fraccion_cofepris || 'NA').trim();
        const piezas = parseInt(String(entrada.piezas_por_caja || '1').trim(), 10);
        const lote = limpiarEspacios(entrada.lote).toUpperCase();
        const caducidad = String(entrada.caducidad || '').trim();
        const modoCajas = entrada.modo_stock === 'cajas';
        const cajas = parseInt(String(entrada.numero_cajas || '').trim(), 10);
        const piezasSueltas = parseInt(String(entrada.stock || '').trim(), 10);
        const stock = modoCajas && Number.isInteger(piezas) && Number.isInteger(cajas) ? piezas * cajas : piezasSueltas;
        const precioCrudo = String(entrada.precio_unitario === undefined || entrada.precio_unitario === null ? '' : entrada.precio_unitario).trim().replace(',', '.');
        const precio = redondearMoneda(precioCrudo);
        const aplica = entrada.aplica_iva === true || entrada.aplica_iva === '1' || entrada.aplica_iva === 'true';
        const errores = {};
        if (!/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(sku)) errores.sku = 'Use un código de 2 a 20 letras, números o guiones.';
        if (nombre.length < 2 || nombre.length > 80) errores.nombre = 'Escriba el principio activo (2 a 80 caracteres).';
        if (nombreComercial.length > 80) errores.nombre_comercial = 'El nombre comercial admite hasta 80 caracteres.';
        if (laboratorio.length < 2 || laboratorio.length > 40) errores.laboratorio = 'Escriba el laboratorio (2 a 40 caracteres).';
        if (proveedor.length > 60) errores.proveedor = 'El proveedor admite hasta 60 caracteres.';
        if (factura && !/^[A-Z0-9][A-Z0-9-]{0,29}$/.test(factura)) errores.numero_factura = 'El folio usa letras, números o guiones.';
        if (!CATEGORIAS_FARMACIA.some(c => c.codigo === categoria)) errores.categoria = 'Seleccione la categoría.';
        if (!FORMAS_FARMACEUTICAS.some(f => f.codigo === forma)) errores.forma_farmaceutica = 'Seleccione la forma farmacéutica.';
        if (concentracion.length > 40) errores.concentracion = 'La concentración admite hasta 40 caracteres.';
        if (!VIAS_ADMINISTRACION.some(v => v.codigo === via)) errores.via_administracion = 'Seleccione la vía.';
        if (!CONSERVACIONES.some(c => c.codigo === conservacion)) errores.conservacion = 'Seleccione la conservación.';
        if (!FRACCIONES_COFEPRIS.some(f => f.codigo === fraccion)) errores.fraccion_cofepris = 'Seleccione la fracción COFEPRIS.';
        if (!Number.isInteger(piezas) || piezas < 1 || piezas > 100) errores.piezas_por_caja = 'Indique de 1 a 100 piezas por caja.';
        if (modoCajas && (!Number.isInteger(cajas) || cajas < 1 || cajas > 9999)) errores.numero_cajas = 'Indique de 1 a 9,999 cajas.';
        if (!/^[A-Z0-9][A-Z0-9-]{0,29}$/.test(lote)) errores.lote = 'Escriba el lote (letras, números o guiones).';
        if (!parseFechaISO(caducidad)) errores.caducidad = 'Indique una fecha de caducidad válida.';
        if (!Number.isInteger(stock) || stock < 1 || stock > 99999) errores.stock = 'El total de piezas debe quedar entre 1 y 99,999.';
        if (!Number.isFinite(precio) || precio < 0.01 || precio > 999999.99) errores.precio_unitario = 'Indique un precio entre $0.01 y $999,999.99.';
        const valores = completarLote({
            sku: sku, nombre: nombre, nombre_comercial: nombreComercial, laboratorio: laboratorio, proveedor: proveedor, numero_factura: factura,
            categoria: categoria, forma_farmaceutica: forma, concentracion: concentracion, via_administracion: via, conservacion: conservacion,
            fraccion_cofepris: fraccion, piezas_por_caja: piezas, lote: lote, caducidad: caducidad, stock: stock, precio_unitario: precio, aplica_iva: aplica
        });
        return { ok: Object.keys(errores).length === 0, errores: errores, valores: valores };
    }
    function ingresarInsumo(entrada, s) {
        if (!puedeGestionarFarmacia(s)) return { ok: false, motivo: 'Su perfil no puede registrar inventario.' };
        const r = validarIngresoFarmacia(entrada);
        if (!r.ok) return { ok: false, motivo: 'Revise los campos marcados.', errores: r.errores };
        const lista = listarFarmacia();
        const v = r.valores;
        const snap = JSON.stringify(lista);
        const ya = lista.find(p => normalizar(p.sku) === normalizar(v.sku) && normalizar(p.lote) === normalizar(v.lote));
        if (ya) {
            Object.assign(ya, v, { lote_id: ya.lote_id, stock: ya.stock + v.stock });
        } else {
            lista.push(Object.assign({ lote_id: uid('LOT') }, v));
        }
        if (!escribir(CLAVES.farmacia, lista)) return { ok: false, motivo: 'No se pudo guardar el ingreso.' };
        const quien = USUARIOS[entrada.operador_id] || USUARIOS[s.usuario_id];
        const mov = movimientoEntrada(v, quien, entrada.modo_stock === 'cajas', parseInt(entrada.numero_cajas, 10));
        if (!anexarMovimientos([mov])) {
            escribir(CLAVES.farmacia, JSON.parse(snap));
            return { ok: false, motivo: 'No se pudo registrar la bitácora. El ingreso no se guardó.' };
        }
        return { ok: true, producto: ya || lista[lista.length - 1] };
    }
    function resolverEscaneo(codigo) {
        const n = normalizar(codigo);
        if (!n) return { ok: false, motivo: 'Escanee o escriba un código.' };
        const todos = listarFarmacia();
        const porLote = todos.filter(p => normalizar(p.lote) === n || normalizar(p.lote_id) === n);
        if (porLote.length === 1) return { ok: true, modo: 'lote', producto: porLote[0] };
        const porSku = todos.filter(p => normalizar(p.sku) === n);
        const base = porSku.length ? porSku : porLote;
        if (!base.length) return { ok: false, motivo: 'Ese código no está en el inventario.' };
        const hoy = hoyLocal();
        const vigentes = base.filter(p => p.stock > 0 && String(p.caducidad) >= hoy).sort((a, b) => String(a.caducidad).localeCompare(String(b.caducidad)));
        if (vigentes.length) return { ok: true, modo: 'sku', producto: vigentes[0] };
        if (base.every(p => String(p.caducidad) < hoy)) return { ok: false, motivo: 'El lote está caducado. No se puede surtir.' };
        return { ok: false, motivo: 'No hay stock disponible de ese código.' };
    }
    function loteMasProximo(producto) {
        if (!producto) return null;
        const hoy = hoyLocal();
        const sku = normalizar(producto.sku), nombre = normalizar(producto.nombre);
        const comercial = normalizar(producto.nombre_comercial);
        return listarFarmacia().filter(p => p.lote_id !== producto.lote_id && p.stock > 0 && String(p.caducidad) >= hoy && String(p.caducidad) < String(producto.caducidad) && (normalizar(p.sku) === sku || normalizar(p.nombre) === nombre || (comercial && normalizar(p.nombre_comercial) === comercial)))
            .sort((a, b) => String(a.caducidad).localeCompare(String(b.caducidad)))[0] || null;
    }
    function prepararLineaCarrito(codigo, opciones) {
        const op = opciones || {};
        let producto, modo = 'lote';
        if (op.lote_id) {
            producto = listarFarmacia().find(p => p.lote_id === op.lote_id);
            if (!producto) return { ok: false, motivo: 'Ese lote ya no está en el inventario.' };
        } else {
            const r = resolverEscaneo(codigo);
            if (!r.ok) return r;
            producto = r.producto;
            modo = r.modo;
        }
        if (String(producto.caducidad) < hoyLocal()) return { ok: false, motivo: 'El lote está caducado. No se puede surtir.' };
        if (producto.stock < 1) return { ok: false, motivo: 'No hay stock disponible de ese lote.' };
        if (!op.ignorar_fefo && modo === 'lote') {
            const alt = loteMasProximo(producto);
            if (alt) return { ok: false, fefo: true, lote: producto, alterno: alt };
        }
        return { ok: true, producto: producto };
    }
    function fichasSurtidoPendiente(s) {
        if (!puedeVerFarmacia(s)) return [];
        return listarSurtido().filter(x => x.estatus === 'pendiente').map(sol => {
            const t = obtenerTurno(sol.turno_id);
            const p = t && buscarPacientePorId(t.paciente_id);
            const i = t && internamientoDeTurno(t.turno_id);
            const cama = (i && i.cama) || sol.cama || (sol.origen === 'consulta' ? 'Consulta' : 'Sin cama');
            const resumen = sol.lineas.filter(l => l.cantidad - (l.cantidad_surtida || 0) > 0).map(l => (l.cantidad - (l.cantidad_surtida || 0)) + 'x ' + l.nombre).join(', ');
            return {
                solicitud_id: sol.solicitud_id, origen: sol.origen, paciente: (p && p.nombre_completo) || (t && t.paciente_nombre) || 'Paciente',
                cama: cama, resumen: resumen, turno_id: sol.turno_id,
                lineas: sol.lineas.map(l => Object.assign({}, l, { sku_sugerido: sugerirSku(l), pendiente: Math.max(0, l.cantidad - (l.cantidad_surtida || 0)) }))
            };
        });
    }
    function elegirLote(codigo) { return resolverEscaneo(codigo); }
    function cargoDesdeProducto(producto, cantidad, quien, extra) {
        const montos = montosProducto(producto, cantidad);
        return Object.assign({
            cargo_id: uid('CG'), concepto: denominacionProducto(producto) + (extra && extra.paquete_nombre ? ' · ' + extra.paquete_nombre : ''),
            sku: producto.sku, lote: producto.lote, lote_id: producto.lote_id, laboratorio: producto.laboratorio || null,
            categoria: producto.categoria || null, fraccion_cofepris: producto.fraccion_cofepris || 'NA', aplica_iva: !!producto.aplica_iva,
            origen: 'farmacia', origen_precio: 'farmacia',
            paquete_id: extra && extra.paquete_id || null, paquete_nombre: extra && extra.paquete_nombre || null,
            fecha_hora: new Date().toISOString(),
            cargado_por_id: quien.id, cargado_por_nombre: quien.nombre
        }, montos, { cargado_en: new Date().toISOString() });
    }
    function anexarCargosFarmacia(turnoId, cargos) {
        const t = obtenerTurno(turnoId);
        if (!t) return null;
        const i = internamientoDeTurno(turnoId);
        const hospital = i && (t.estatus === ESTATUS.INTERNADO || t.estatus === ESTATUS.INTERNADO_EN_PROCESO);
        if (hospital) {
            i.cargos = (i.cargos || []).concat(cargos);
            i.cuenta_actual = totalCargos(i.cargos);
            i.cuenta_actual_total = i.cuenta_actual;
            if (!guardarInternamiento(i)) return null;
        }
        const parche = {};
        if (!hospital) parche.cargos = (t.cargos || []).concat(cargos);
        const vista = hospital ? obtenerTurno(turnoId) : Object.assign({}, t, { cargos: parche.cargos });
        const total = totalCargos(cargosDeEpisodio(vista));
        parche.cuenta_actual = total;
        parche.cuenta_actual_total = total;
        if (t.estatus === ESTATUS.ALTA) parche.estatus = ESTATUS.ALTA_PENDIENTE_PAGO;
        return actualizarTurno(turnoId, parche) ? { total: total } : null;
    }
    function cobrarUnidadFarmacia(turnoId, producto, s, cargoId) {
        const t = obtenerTurno(turnoId);
        if (!t) return { ok: false, motivo: 'No se encontró el episodio.' };
        if (t.estatus === ESTATUS.CERRADO_HISTORICO) return { ok: false, motivo: 'El expediente ya está cerrado.' };
        const i = internamientoDeTurno(turnoId);
        if (i && i.estatus === ESTATUS.CERRADO_HISTORICO) return { ok: false, motivo: 'El expediente ya está cerrado.' };
        const montos = montosProducto(producto, 1);
        let ajustado = false;
        const tocar = lista => (lista || []).forEach(c => {
            if (c && c.cargo_id === cargoId) {
                Object.assign(c, montos, {
                    concepto: producto.nombre, sku: producto.sku, lote: producto.lote, lote_id: producto.lote_id,
                    aplica_iva: !!producto.aplica_iva, fraccion_cofepris: producto.fraccion_cofepris || null,
                    origen_precio: 'farmacia', fecha_hora: c.fecha_hora || new Date().toISOString(),
                    cargado_por_id: c.cargado_por_id || s.usuario_id, cargado_por_nombre: c.cargado_por_nombre || s.nombre
                });
                ajustado = true;
            }
        });
        if (cargoId) {
            if (i) tocar(i.cargos);
            tocar(t.cargos);
        }
        if (!ajustado) {
            const cargo = cargoDesdeProducto(producto, 1, { id: s.usuario_id, nombre: s.nombre });
            if (i) i.cargos = (i.cargos || []).concat([cargo]);
            else t.cargos = (t.cargos || []).concat([cargo]);
        }
        if (i) {
            i.cuenta_actual = totalCargos(i.cargos);
            i.cuenta_actual_total = i.cuenta_actual;
            if (!guardarInternamiento(i)) return { ok: false, motivo: 'No se pudo guardar el cargo en la cuenta.' };
        }
        const total = totalCargos(cargosDeEpisodio(i ? obtenerTurno(turnoId) : t));
        const parche = { cuenta_actual: total, cuenta_actual_total: total };
        if (!i || ajustado) parche.cargos = t.cargos;
        if (t.estatus === ESTATUS.ALTA) parche.estatus = ESTATUS.ALTA_PENDIENTE_PAGO;
        return actualizarTurno(turnoId, parche) ? { ok: true, total: total } : { ok: false, motivo: 'No se pudo actualizar la cuenta.' };
    }
    function surtirLinea(solicitudId, codigo, s, opciones) {
        if (!puedeGestionarFarmacia(s)) return { ok: false, motivo: 'Su perfil no puede surtir medicamentos.' };
        const op = opciones || {};
        const cola = listarSurtido();
        const sol = cola.find(x => x.solicitud_id === solicitudId && x.estatus === 'pendiente');
        if (!sol) return { ok: false, motivo: 'Esa solicitud ya no está pendiente.' };
        const t = obtenerTurno(sol.turno_id);
        if (!t || t.estatus === ESTATUS.CERRADO_HISTORICO) return { ok: false, motivo: 'El expediente ya está cerrado.' };
        const prep = prepararLineaCarrito(codigo, { lote_id: op.lote_id || null, ignorar_fefo: !!op.ignorar_fefo });
        if (!prep.ok) return prep;
        const lote = prep.producto;
        const pendientes = sol.lineas.filter(l => l.estatus !== 'surtida' && (l.cantidad_surtida || 0) < l.cantidad);
        let mejor = null, pts = 0;
        pendientes.forEach(l => { const p = puntajeLinea(l, lote); if (p > pts) { pts = p; mejor = l; } });
        if (!mejor || pts < 40) return { ok: false, motivo: 'Ese código no corresponde a lo solicitado.' };
        const catalogo = listarFarmacia();
        const row = catalogo.find(p => p.lote_id === lote.lote_id);
        if (!row || row.stock < 1) return { ok: false, motivo: 'No hay stock disponible de ese código.' };
        const snapCat = JSON.stringify(catalogo);
        const snapCola = JSON.stringify(cola);
        const snapTurnos = localStorage.getItem(CLAVES.turnos);
        const snapInts = localStorage.getItem(CLAVES.internamientos);
        const snapHosp = localStorage.getItem(CLAVES.hospitalizados);
        const revertirSurtido = () => {
            escribir(CLAVES.farmacia, JSON.parse(snapCat));
            escribir(CLAVES.surtido, JSON.parse(snapCola));
            if (snapTurnos === null) localStorage.removeItem(CLAVES.turnos); else localStorage.setItem(CLAVES.turnos, snapTurnos);
            if (snapInts === null) localStorage.removeItem(CLAVES.internamientos); else localStorage.setItem(CLAVES.internamientos, snapInts);
            if (snapHosp === null) localStorage.removeItem(CLAVES.hospitalizados); else localStorage.setItem(CLAVES.hospitalizados, snapHosp);
        };
        row.stock -= 1;
        if (!escribir(CLAVES.farmacia, catalogo)) return { ok: false, motivo: 'No se pudo actualizar el inventario.' };
        const ajustar = !!(mejor.facturado && mejor.cargo_id && !(mejor.cantidad_surtida > 0));
        const cobro = cobrarUnidadFarmacia(sol.turno_id, row, s, ajustar ? mejor.cargo_id : null);
        if (!cobro.ok) { revertirSurtido(); return cobro; }
        mejor.cantidad_surtida = (mejor.cantidad_surtida || 0) + 1;
        mejor.sku = row.sku;
        if (mejor.cantidad_surtida >= mejor.cantidad) mejor.estatus = 'surtida';
        const completa = sol.lineas.every(l => l.estatus === 'surtida');
        if (completa) { sol.estatus = 'surtida'; sol.surtida_en = new Date().toISOString(); sol.surtida_por = s.nombre; }
        if (!escribir(CLAVES.surtido, cola)) { revertirSurtido(); return { ok: false, motivo: 'No se pudo cerrar la solicitud. El inventario no se modificó.' }; }
        const destino = fichaDestinoKardex(t);
        const quien = USUARIOS[s.usuario_id] || { id: s.usuario_id, nombre: s.nombre, cedula_profesional: '' };
        if (!anexarMovimientos([movimientoSalida(row, 1, quien, destino)])) {
            revertirSurtido();
            return { ok: false, motivo: 'No se pudo registrar la bitácora. El surtido no se guardó.' };
        }
        return { ok: true, solicitud: sol, producto: row, total: cobro.total, completa: completa };
    }

    function listarPaquetes() { return leer(CLAVES.paquetes, []); }
    function listarCajas() { return leer(CLAVES.cajasEstupefacientes, []); }
    function validarPaquete(entrada) {
        const nombre = limpiarEspacios(entrada.nombre);
        const items = Array.isArray(entrada.items) ? entrada.items : [];
        const errores = {};
        if (nombre.length < 2 || nombre.length > 80) errores.nombre = 'Escriba el nombre del paquete (2 a 80 caracteres).';
        if (!items.length || items.length > 30) errores.items = 'Agregue de 1 a 30 insumos.';
        const limpios = [];
        items.forEach(it => {
            const sku = limpiarEspacios(it.sku).toUpperCase();
            const cantidad = parseInt(it.cantidad, 10);
            const prod = productoPorSku(sku);
            if (!prod || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > 99) errores.items = 'Cada ítem necesita un código del inventario y una cantidad de 1 a 99.';
            else if (prod.fraccion_cofepris === 'I') errores.items = 'La fracción I no entra en un paquete. Se carga ámpula por ámpula.';
            else limpios.push({ sku: sku, cantidad: cantidad });
        });
        return { ok: Object.keys(errores).length === 0, errores: errores, valores: { nombre: nombre, items: limpios } };
    }
    function guardarPaquete(entrada, s, idExistente) {
        if (!puedeGestionarFarmacia(s)) return { ok: false, motivo: 'Su perfil no puede editar paquetes.' };
        const r = validarPaquete(entrada);
        if (!r.ok) return { ok: false, motivo: 'Revise los campos marcados.', errores: r.errores };
        const lista = listarPaquetes();
        const ya = idExistente ? lista.find(p => p.paquete_id === idExistente) : null;
        if (idExistente && !ya) return { ok: false, motivo: 'No se encontró el paquete.' };
        const ficha = { paquete_id: ya ? ya.paquete_id : uid('PAQ'), nombre: r.valores.nombre, items: r.valores.items, actualizado_en: new Date().toISOString() };
        if (ya) Object.assign(ya, ficha); else lista.unshift(ficha);
        return escribir(CLAVES.paquetes, lista) ? { ok: true, paquete: ficha } : { ok: false, motivo: 'No se pudo guardar el paquete.' };
    }
    function eliminarPaquete(id, s) {
        if (!puedeGestionarFarmacia(s)) return { ok: false, motivo: 'Su perfil no puede eliminar paquetes.' };
        const lista = listarPaquetes().filter(p => p.paquete_id !== id);
        return escribir(CLAVES.paquetes, lista) ? { ok: true } : { ok: false, motivo: 'No se pudo eliminar el paquete.' };
    }
    function lineasDePaquete(paqueteId) {
        const paq = listarPaquetes().find(p => p.paquete_id === paqueteId);
        if (!paq) return { ok: false, motivo: 'No se encontró el paquete.' };
        const hoy = hoyLocal();
        const lineas = [];
        for (let k = 0; k < paq.items.length; k++) {
            const item = paq.items[k];
            const delSku = listarFarmacia().filter(p => normalizar(p.sku) === normalizar(item.sku));
            const muestra = delSku[0];
            if (!muestra) return { ok: false, motivo: 'El paquete incluye un código que ya no está en el inventario: ' + item.sku };
            const vigentes = delSku.filter(p => p.stock > 0 && String(p.caducidad) >= hoy).sort((a, b) => String(a.caducidad).localeCompare(String(b.caducidad)));
            const extra = { paquete_id: paq.paquete_id, paquete_nombre: paq.nombre, ignorar_fefo: true };
            if (esInsumoFisico(muestra)) {
                const disponible = vigentes.reduce((s, p) => s + p.stock, 0);
                if (disponible < item.cantidad) return { ok: false, motivo: 'No alcanza el stock de ' + muestra.nombre + ' para armar el paquete.' };
                let falta = item.cantidad;
                vigentes.forEach(l => {
                    if (falta < 1) return;
                    const tomar = Math.min(l.stock, falta);
                    lineas.push(Object.assign({ lote_id: l.lote_id, cantidad: tomar }, extra));
                    falta -= tomar;
                });
            } else {
                lineas.push(Object.assign({ lote_id: (vigentes[0] || muestra).lote_id, cantidad: item.cantidad, servicio: !vigentes.length }, extra));
            }
        }
        return { ok: true, paquete: paq, lineas: lineas };
    }

    function enfermerasActivas() {
        return Object.values(USUARIOS).filter(u => u.activo !== false && (ENFERMERIAS.indexOf(u.rol) >= 0 || u.rol === 'enf_farmacia'))
            .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    }
    function clasificarAreaFarmacia(t) {
        if (!t) return null;
        if (t.estatus === ESTATUS.EN_CONSULTA) return 'consulta';
        if (t.estatus !== ESTATUS.INTERNADO && t.estatus !== ESTATUS.INTERNADO_EN_PROCESO) return null;
        const i = internamientoDeTurno(t.turno_id);
        const blob = normalizar([i && i.area_destino, i && i.destino, t.area_destino, t.destino].filter(Boolean).join(' '));
        if (blob.indexOf('quirof') >= 0 || blob.indexOf('recuper') >= 0) return 'quirofano';
        const hoy = hoyLocal();
        const enSala = listarCirugias().some(c => c.estatus === 'programada' && String(c.fecha_hora).slice(0, 10) === hoy && (c.paciente_id === t.paciente_id || normalizar(c.paciente_nombre) === normalizar(t.paciente_nombre)));
        if (enSala) return 'quirofano';
        if (blob.indexOf('observ') >= 0) return 'observacion';
        return 'hospital';
    }
    function pacientesTerminalFarmacia(s) {
        const grupos = { hospital: [], observacion: [], quirofano: [], consulta: [] };
        if (!puedeVerFarmacia(s)) return grupos;
        listarTurnos().forEach(t => {
            const area = clasificarAreaFarmacia(t);
            if (!area) return;
            const i = internamientoDeTurno(t.turno_id);
            const p = buscarPacientePorId(t.paciente_id);
            grupos[area].push({
                turno_id: t.turno_id, paciente_id: t.paciente_id,
                nombre: (p && p.nombre_completo) || t.paciente_nombre || 'Paciente',
                edad: p ? calcularEdad(p.fecha_nacimiento) : calcularEdad(t.fecha_nacimiento),
                cama: (i && i.cama) || (area === 'consulta' ? 'Consulta' : 'Sin cama'),
                area: area,
                area_txt: area === 'consulta' ? 'Consulta' : area === 'observacion' ? 'Observación' : area === 'quirofano' ? 'Quirófano / Recuperación' : 'Hospitalización',
                medico: t.medico_nombre || '', estatus: t.estatus
            });
        });
        return grupos;
    }
    function cajasAbiertasDe(sku) {
        return listarCajas().filter(c => normalizar(c.sku) === normalizar(sku) && c.usadas < c.piezas_por_caja);
    }
    function abrirCajaEstupefaciente(entrada, s) {
        if (!puedeGestionarFarmacia(s)) return { ok: false, motivo: 'Su perfil no puede abrir una caja de estupefacientes.' };
        const lote = listarFarmacia().find(p => p.lote_id === entrada.lote_id);
        if (!lote || lote.fraccion_cofepris !== 'I') return { ok: false, motivo: 'Ese lote no es fracción I.' };
        const folio = limpiarEspacios(entrada.folio_receta_especial).toUpperCase();
        if (!/^[A-Z0-9][A-Z0-9-]{2,24}$/.test(folio)) return { ok: false, motivo: 'Escriba el folio de la receta especial del responsable sanitario.' };
        const cajas = listarCajas();
        if (cajas.some(c => normalizar(c.folio_receta_especial) === normalizar(folio))) return { ok: false, motivo: 'Ese folio ya está registrado.' };
        const responsable = USUARIOS[entrada.responsable_id] || null;
        const caja = {
            caja_id: uid('CAJA'), sku: lote.sku, nombre: lote.nombre, lote_id: lote.lote_id, lote: lote.lote,
            piezas_por_caja: lote.piezas_por_caja || 5, usadas: 0, folio_receta_especial: folio,
            responsable_id: responsable ? responsable.id : s.usuario_id,
            responsable_nombre: responsable ? responsable.nombre : s.nombre,
            creada_en: new Date().toISOString(), usos: []
        };
        cajas.unshift(caja);
        return escribir(CLAVES.cajasEstupefacientes, cajas) ? { ok: true, caja: caja } : { ok: false, motivo: 'No se pudo abrir la caja.' };
    }
    function confirmarCarritoFarmacia(entrada, s) {
        if (!puedeGestionarFarmacia(s)) return { ok: false, motivo: 'Su perfil no puede cargar a la cuenta.' };
        const t = obtenerTurno(entrada.turno_id);
        if (!t) return { ok: false, motivo: 'No se encontró al paciente.' };
        if ([ESTATUS.EN_CONSULTA, ESTATUS.INTERNADO, ESTATUS.INTERNADO_EN_PROCESO].indexOf(t.estatus) < 0) return { ok: false, motivo: 'Ese paciente ya no está activo.' };
        const operador = entrada.operador_id ? USUARIOS[entrada.operador_id] : null;
        const enf = entrada.atribuir_sesion ? null : USUARIOS[entrada.enfermera_id];
        const quien = operador && operador.activo !== false
            ? { id: operador.id, nombre: operador.nombre }
            : entrada.atribuir_sesion
            ? (puedeCargarConsumos(s) ? { id: s.usuario_id, nombre: s.nombre } : null)
            : (enf && enf.activo !== false && (ENFERMERIAS.indexOf(enf.rol) >= 0 || enf.rol === 'enf_farmacia') ? enf : null);
        if (!quien) return { ok: false, motivo: entrada.operador_id ? 'Identifíquese con su código personal para operar.' : (entrada.atribuir_sesion ? 'Su perfil no puede cargar consumos.' : 'Seleccione a la enfermera que retira y carga.') };
        const fichaQuien = USUARIOS[quien.id];
        quien.cedula_profesional = (fichaQuien && fichaQuien.cedula_profesional) || quien.cedula_profesional || '';
        const lineas = entrada.lineas || [];
        if (!lineas.length) return { ok: false, motivo: 'El carrito está vacío.' };
        const catalogo = listarFarmacia();
        const usos = [];
        const cargos = [];
        const descuentos = {};
        for (let k = 0; k < lineas.length; k++) {
            const lin = lineas[k];
            const prod = catalogo.find(p => p.lote_id === lin.lote_id);
            if (!prod) return { ok: false, motivo: 'Un lote del carrito ya no está en el inventario.' };
            const cant = parseInt(lin.cantidad, 10);
            if (!Number.isInteger(cant) || cant < 1 || cant > 99) return { ok: false, motivo: 'Cantidad inválida de ' + prod.nombre + '.' };
            if (!lin.servicio && String(prod.caducidad) < hoyLocal()) return { ok: false, motivo: prod.nombre + ' está caducado.' };
            if (!lin.ignorar_fefo) {
                const alt = loteMasProximo(prod);
                if (alt) return { ok: false, fefo: true, lote: prod, alterno: alt };
            }
            if (prod.fraccion_cofepris === 'I') {
                if (cant !== 1) return { ok: false, motivo: 'La fracción I se registra de una ámpula en una ámpula.' };
                const datos = limpiarEspacios(lin.datos_postanestesicos);
                if (datos.length < 8) return { ok: false, motivo: 'Registre los datos post-anestésicos de la ámpula.' };
                const caja = listarCajas().find(c => c.caja_id === lin.caja_id && normalizar(c.sku) === normalizar(prod.sku));
                if (!caja) return { ok: false, motivo: 'Seleccione la caja de estupefacientes.' };
                const ya = usos.filter(u => u.caja_id === caja.caja_id).length;
                if (caja.usadas + ya >= caja.piezas_por_caja) return { ok: false, motivo: 'La caja ' + caja.folio_receta_especial + ' ya completó sus recetas.' };
                usos.push({ caja_id: caja.caja_id, datos: datos, lote_id: prod.lote_id });
            }
            const previo = descuentos[prod.lote_id] || 0;
            if (!lin.servicio && prod.stock < previo + cant) return { ok: false, motivo: 'No hay stock suficiente de ' + prod.nombre + ' (lote ' + prod.lote + ').' };
            if (!lin.servicio) descuentos[prod.lote_id] = previo + cant;
            cargos.push(cargoDesdeProducto(prod, cant, quien, lin));
        }
        const snapCat = JSON.stringify(catalogo);
        const snapCajas = JSON.stringify(listarCajas());
        Object.keys(descuentos).forEach(id => { catalogo.find(p => p.lote_id === id).stock -= descuentos[id]; });
        if (!escribir(CLAVES.farmacia, catalogo)) return { ok: false, motivo: 'No se pudo actualizar el inventario.' };
        const cajas = JSON.parse(snapCajas);
        const recetas = [];
        usos.forEach(u => {
            const caja = cajas.find(c => c.caja_id === u.caja_id);
            caja.usadas += 1;
            const cargo = cargos.find(c => c.lote_id === u.lote_id && c.fraccion_cofepris === 'I' && !c.receta_individual);
            const uso = {
                uso_id: uid('AMP'), numero: caja.usadas, de: caja.piezas_por_caja,
                turno_id: t.turno_id, paciente_nombre: t.paciente_nombre, fecha_hora: new Date().toISOString(),
                datos_postanestesicos: u.datos, lote: cargo ? cargo.lote : '', sku: cargo ? cargo.sku : '',
                cargo_id: cargo ? cargo.cargo_id : null
            };
            caja.usos = (caja.usos || []).concat([uso]);
            if (cargo) { cargo.receta_individual = uso.numero + '/' + uso.de; cargo.folio_receta_especial = caja.folio_receta_especial; cargo.datos_postanestesicos = u.datos; }
            recetas.push(Object.assign({ folio_receta_especial: caja.folio_receta_especial, nombre: caja.nombre }, uso));
        });
        if (usos.length && !escribir(CLAVES.cajasEstupefacientes, cajas)) {
            escribir(CLAVES.farmacia, JSON.parse(snapCat));
            return { ok: false, motivo: 'No se pudo registrar la receta de la caja.' };
        }
        const snapTurnos = localStorage.getItem(CLAVES.turnos);
        const snapInts = localStorage.getItem(CLAVES.internamientos);
        const snapHosp = localStorage.getItem(CLAVES.hospitalizados);
        const guardado = anexarCargosFarmacia(t.turno_id, cargos);
        if (!guardado) {
            escribir(CLAVES.farmacia, JSON.parse(snapCat));
            if (usos.length) escribir(CLAVES.cajasEstupefacientes, JSON.parse(snapCajas));
            return { ok: false, motivo: 'No se pudo cargar la cuenta. El inventario no se modificó.' };
        }
        const destino = fichaDestinoKardex(t);
        const movs = [];
        lineas.forEach(lin => {
            if (lin.servicio) return;
            const prod = catalogo.find(p => p.lote_id === lin.lote_id);
            if (prod) movs.push(movimientoSalida(prod, parseInt(lin.cantidad, 10), quien, destino));
        });
        if (movs.length && !anexarMovimientos(movs)) {
            escribir(CLAVES.farmacia, JSON.parse(snapCat));
            if (usos.length) escribir(CLAVES.cajasEstupefacientes, JSON.parse(snapCajas));
            if (snapTurnos === null) localStorage.removeItem(CLAVES.turnos); else localStorage.setItem(CLAVES.turnos, snapTurnos);
            if (snapInts === null) localStorage.removeItem(CLAVES.internamientos); else localStorage.setItem(CLAVES.internamientos, snapInts);
            if (snapHosp === null) localStorage.removeItem(CLAVES.hospitalizados); else localStorage.setItem(CLAVES.hospitalizados, snapHosp);
            return { ok: false, motivo: 'No se pudo registrar la bitácora. La cuenta y el inventario no se modificaron.' };
        }
        return { ok: true, cargos: cargos, total: guardado.total, recetas: recetas };
    }
    function listarMovimientosFarmacia() { return leer(CLAVES.movimientosFarmacia, []); }
    function anexarMovimientos(nuevos) {
        if (!nuevos || !nuevos.length) return true;
        return escribir(CLAVES.movimientosFarmacia, listarMovimientosFarmacia().concat(nuevos));
    }
    function identidadMovimiento(quien) {
        const ficha = quien && (USUARIOS[quien.id] || quien);
        return {
            usuario_id: ficha ? (ficha.id || '') : '',
            nombre: ficha ? (ficha.nombre || '') : '',
            cedula_profesional: ficha ? (ficha.cedula_profesional || '') : ''
        };
    }
    function movimientoEntrada(valores, quien, porCajas, numeroCajas) {
        const idn = identidadMovimiento(quien);
        const cajas = porCajas && Number.isInteger(numeroCajas) ? numeroCajas : '';
        return Object.assign({
            movimiento_id: uid('MOV'), tipo: 'ENTRADA', fecha_hora: new Date().toISOString(),
            sku: valores.sku, principio_activo: valores.nombre, nombre_comercial: valores.nombre_comercial || '',
            laboratorio: valores.laboratorio || '', proveedor: valores.proveedor || '', numero_factura: valores.numero_factura || '',
            forma_farmaceutica: valores.forma_farmaceutica || '', concentracion: valores.concentracion || '',
            fraccion_cofepris: valores.fraccion_cofepris || 'NA', lote: valores.lote, caducidad: valores.caducidad,
            cajas_ingresadas: cajas, piezas_por_caja: valores.piezas_por_caja, total_piezas: valores.stock, cantidad_piezas: '',
            precio_unitario: valores.precio_unitario, aplica_iva: !!valores.aplica_iva,
            paciente_id: '', paciente_nombre: '', paciente_edad: '', area_paciente: '', cama: '', medico_tratante: ''
        }, idn);
    }
    function etiquetaAreaKardex(turno) {
        const area = clasificarAreaFarmacia(turno);
        if (area === 'consulta') return 'Consulta Actual';
        if (area === 'observacion') return 'Observación';
        if (area === 'hospital') return 'Hospitalización';
        if (area !== 'quirofano') return 'Hospitalización';
        const i = internamientoDeTurno(turno.turno_id);
        const blob = normalizar([i && i.area_destino, i && i.destino, turno.area_destino, turno.destino].filter(Boolean).join(' '));
        if (blob.indexOf('recuper') >= 0 && blob.indexOf('quirof') < 0) return 'Recuperación';
        return 'Quirófano / Operándose';
    }
    function fichaDestinoKardex(turno) {
        const p = buscarPacientePorId(turno.paciente_id);
        const i = internamientoDeTurno(turno.turno_id);
        const area = clasificarAreaFarmacia(turno);
        return {
            paciente_id: turno.paciente_id || '',
            paciente_nombre: (p && p.nombre_completo) || turno.paciente_nombre || '',
            paciente_edad: p ? calcularEdad(p.fecha_nacimiento) : calcularEdad(turno.fecha_nacimiento),
            paciente_telefono: (p && p.telefono) || turno.telefono || (i && i.telefono) || '',
            paciente_direccion: (p && p.direccion) || turno.direccion || (i && i.direccion) || '',
            area_paciente: etiquetaAreaKardex(turno),
            cama: (i && i.cama) || (area === 'consulta' ? 'Consulta' : ''),
            medico_tratante: turno.medico_nombre || ''
        };
    }
    function movimientoSalida(prod, cantidad, quien, destino) {
        const idn = identidadMovimiento(quien);
        const d = destino || {};
        return Object.assign({
            movimiento_id: uid('MOV'), tipo: 'SALIDA', fecha_hora: new Date().toISOString(),
            sku: prod.sku, principio_activo: prod.nombre, nombre_comercial: prod.nombre_comercial || '',
            laboratorio: prod.laboratorio || '', proveedor: prod.proveedor || '', numero_factura: prod.numero_factura || '',
            forma_farmaceutica: prod.forma_farmaceutica || '', concentracion: prod.concentracion || '',
            fraccion_cofepris: prod.fraccion_cofepris || 'NA', lote: prod.lote, caducidad: prod.caducidad,
            cajas_ingresadas: '', piezas_por_caja: prod.piezas_por_caja || '', total_piezas: '', cantidad_piezas: cantidad,
            precio_unitario: prod.precio_unitario, aplica_iva: !!prod.aplica_iva,
            paciente_id: d.paciente_id || '', paciente_nombre: d.paciente_nombre || '',
            paciente_edad: d.paciente_edad === 0 ? 0 : (d.paciente_edad || ''),
            paciente_telefono: d.paciente_telefono || '',
            paciente_direccion: d.paciente_direccion || '',
            area_paciente: d.area_paciente || '', cama: d.cama || '', medico_tratante: d.medico_tratante || ''
        }, idn);
    }
    function fechaLocalDeIso(iso) {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function filtrarMovimientosFarmacia(s, filtros) {
        if (!s || !permisoAccionDe(s.usuario_id, 'ver_bitacora_farmacia')) return [];
        const f = filtros || {};
        const tipo = f.tipo === 'ENTRADA' || f.tipo === 'SALIDA' ? f.tipo : '';
        const persona = normalizar(f.persona || '');
        const med = normalizar(f.medicamento || '');
        return listarMovimientosFarmacia().filter(m => {
            if (tipo && m.tipo !== tipo) return false;
            const dia = fechaLocalDeIso(m.fecha_hora);
            if (f.desde && dia < f.desde) return false;
            if (f.hasta && dia > f.hasta) return false;
            if (persona && normalizar(m.nombre).indexOf(persona) < 0 && normalizar(m.usuario_id).indexOf(persona) < 0) return false;
            if (med && normalizar(m.principio_activo).indexOf(med) < 0 && normalizar(m.nombre_comercial).indexOf(med) < 0 && normalizar(m.sku).indexOf(med) < 0) return false;
            return true;
        });
    }
    const MESES_KARDEX = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    function carpetasMovimientosFarmacia(lista) {
        const anios = {};
        (lista || []).forEach(m => {
            const d = new Date(m.fecha_hora);
            if (isNaN(d.getTime())) return;
            const anio = String(d.getFullYear());
            const mes = d.getMonth() + 1;
            const semana = Math.min(5, Math.ceil(d.getDate() / 7));
            anios[anio] = anios[anio] || {};
            anios[anio][mes] = anios[anio][mes] || {};
            anios[anio][mes][semana] = anios[anio][mes][semana] || [];
            anios[anio][mes][semana].push(m);
        });
        return Object.keys(anios).sort((a, b) => Number(b) - Number(a)).map(anio => ({
            anio: anio,
            meses: Object.keys(anios[anio]).sort((a, b) => Number(b) - Number(a)).map(mes => {
                const ultimo = new Date(Number(anio), Number(mes), 0).getDate();
                return {
                    mes: Number(mes), nombre: MESES_KARDEX[Number(mes) - 1],
                    semanas: Object.keys(anios[anio][mes]).sort((a, b) => Number(b) - Number(a)).map(sem => ({
                        semana: Number(sem),
                        etiqueta: 'Semana ' + sem + ' · días ' + ((Number(sem) - 1) * 7 + 1) + '–' + Math.min(Number(sem) * 7, ultimo),
                        movimientos: anios[anio][mes][sem].slice().sort((a, b) => String(b.fecha_hora).localeCompare(String(a.fecha_hora)))
                    }))
                };
            })
        }));
    }
    function csvCelda(valor) {
        const s = valor === null || valor === undefined ? '' : String(valor);
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    function csvMovimientosFarmacia(s, filtros) {
        if (!s || !permisoAccionDe(s.usuario_id, 'ver_bitacora_farmacia')) return '';
        const f = Object.assign({}, filtros || {});
        if (f.tipoExport === 'ENTRADA' || f.tipoExport === 'SALIDA') f.tipo = f.tipoExport;
        else if (f.tipoExport === 'AMBOS') f.tipo = '';
        const filas = filtrarMovimientosFarmacia(s, f);
        const incluyePaciente = f.tipo !== 'ENTRADA';
        const encabezado = ['Tipo', 'Fecha y hora', 'Usuario', 'Nombre', 'Cédula', 'SKU', 'Principio activo', 'Nombre comercial', 'Laboratorio', 'Proveedor', 'Número de factura', 'Forma farmacéutica', 'Concentración', 'Fracción COFEPRIS', 'Lote', 'Caducidad', 'Cajas ingresadas', 'Piezas por caja', 'Total de piezas ingresadas', 'Cantidad de piezas retiradas', 'Precio unitario', 'Grava IVA', 'Paciente', 'Edad', 'Área', 'Cama', 'Médico tratante'].concat(incluyePaciente ? ['Teléfono / Celular Paciente', 'Dirección Paciente'] : []);
        const lineas = filas.slice().sort((a, b) => String(a.fecha_hora).localeCompare(String(b.fecha_hora))).map(m => {
            const celdas = [
                m.tipo, m.fecha_hora, m.usuario_id, m.nombre, m.cedula_profesional, m.sku, m.principio_activo, m.nombre_comercial,
                m.laboratorio, m.proveedor, m.numero_factura, nombreFormaFarmaceutica(m.forma_farmaceutica), m.concentracion,
                nombreFraccionCofepris(m.fraccion_cofepris), m.lote, m.caducidad, m.cajas_ingresadas, m.piezas_por_caja, m.total_piezas,
                m.cantidad_piezas, m.precio_unitario, m.aplica_iva ? 'Sí' : 'No', m.paciente_nombre, m.paciente_edad, m.area_paciente, m.cama, m.medico_tratante
            ];
            if (incluyePaciente) celdas.push(m.paciente_telefono || '', m.paciente_direccion || '');
            return celdas.map(csvCelda).join(',');
        });
        return '\uFEFF' + encabezado.join(',') + '\r\n' + lineas.join('\r\n');
    }
    function cargoBaseSinIva(c) {
        if (!c || typeof c !== 'object') return false;
        const cant = Number(c.cantidad || 1);
        const base = redondearMoneda(c.precio_unitario);
        const sub = redondearMoneda(c.subtotal);
        const con = c.precio_con_iva == null ? base : redondearMoneda(c.precio_con_iva);
        let cambio = false;
        if (c.aplica_iva && con > base && sub === redondearMoneda(con * cant)) {
            c.subtotal = redondearMoneda(base * cant);
            c.iva_unitario = 0;
            c.iva_total = 0;
            cambio = true;
        }
        if (typeof c.aplica_iva !== 'boolean') { c.aplica_iva = false; cambio = true; }
        return cambio;
    }
    function normalizarIvaDiferido() {
        if (localStorage.getItem(CLAVES.ivaDiferido) === '1') return;
        listarInternamientos().forEach(i => {
            let cambio = false;
            (i.cargos || []).forEach(c => { if (cargoBaseSinIva(c)) cambio = true; });
            if (!cambio) return;
            i.cuenta_actual = totalCargos(i.cargos);
            i.cuenta_actual_total = i.cuenta_actual;
            guardarInternamiento(i);
        });
        listarTurnos().forEach(t => {
            let cambio = false;
            (t.cargos || []).forEach(c => { if (cargoBaseSinIva(c)) cambio = true; });
            const fresco = obtenerTurno(t.turno_id) || t;
            const total = totalCargos(cargosDeEpisodio(fresco));
            if (cambio || redondearMoneda(fresco.cuenta_actual) !== total) actualizarTurno(t.turno_id, { cargos: t.cargos, cuenta_actual: total, cuenta_actual_total: total });
        });
        escribir(CLAVES.ivaDiferido, '1');
    }
    function sugerirIvaConcepto(concepto) {
        const n = normalizar(concepto);
        if (n.length < 2) return null;
        const prod = listarFarmacia().find(p => normalizar(p.sku) === n || normalizar(p.nombre) === n || normalizar(p.nombre_comercial) === n);
        return prod ? !!prod.aplica_iva : null;
    }

    function listarSalidasFarmacia() { return leer(CLAVES.salidasFarmacia, []); }
    function listarCajasEstupefacientes(s) {
        if (!s || !permisoAccionDe(s.usuario_id, 'farmacia_estupefacientes')) return [];
        return listarCajas();
    }
    function registrarRetiroAdministracion(entrada, s) {
        if (!puedeGestionarFarmacia(s)) return { ok: false, motivo: 'Su perfil no puede registrar salidas de almacén.' };
        const op = USUARIOS[entrada.operador_id];
        if (!op || op.activo === false || op.rol !== 'admin') return { ok: false, motivo: 'Solo dirección, identificada con su código, puede retirar sin paciente.' };
        const lineas = entrada.lineas || [];
        if (!lineas.length) return { ok: false, motivo: 'El carrito está vacío.' };
        const catalogo = listarFarmacia();
        const descuentos = {};
        const salidas = [];
        for (let k = 0; k < lineas.length; k++) {
            const lin = lineas[k];
            const prod = catalogo.find(p => p.lote_id === lin.lote_id);
            if (!prod) return { ok: false, motivo: 'Un lote del carrito ya no está en el inventario.' };
            if (prod.fraccion_cofepris === 'I') return { ok: false, motivo: 'La fracción I se retira ligada a un paciente y a su receta individual.' };
            const cant = parseInt(lin.cantidad, 10);
            if (!Number.isInteger(cant) || cant < 1 || cant > 99) return { ok: false, motivo: 'Cantidad inválida de ' + prod.nombre + '.' };
            const previo = descuentos[prod.lote_id] || 0;
            if (prod.stock < previo + cant) return { ok: false, motivo: 'No hay stock suficiente de ' + prod.nombre + ' (lote ' + prod.lote + ').' };
            descuentos[prod.lote_id] = previo + cant;
            salidas.push({
                salida_id: uid('SAL'), lote_id: prod.lote_id, sku: prod.sku, nombre: denominacionProducto(prod), lote: prod.lote,
                cantidad: cant, fecha_hora: new Date().toISOString(), operador_id: op.id, operador_nombre: op.nombre, tipo: 'retiro_administracion'
            });
        }
        const snap = JSON.stringify(catalogo);
        Object.keys(descuentos).forEach(id => { catalogo.find(p => p.lote_id === id).stock -= descuentos[id]; });
        if (!escribir(CLAVES.farmacia, catalogo)) return { ok: false, motivo: 'No se pudo actualizar el inventario.' };
        const bitacora = listarSalidasFarmacia().concat(salidas);
        if (!escribir(CLAVES.salidasFarmacia, bitacora)) {
            escribir(CLAVES.farmacia, JSON.parse(snap));
            return { ok: false, motivo: 'No se pudo guardar la bitácora. El inventario no se modificó.' };
        }
        const destinoAdmin = { paciente_id: '', paciente_nombre: '', paciente_edad: '', area_paciente: 'RETIRO DIRECTO ADMINISTRACIÓN', cama: '', medico_tratante: '' };
        const movs = salidas.map(sal => {
            const prod = catalogo.find(p => p.lote_id === sal.lote_id);
            return movimientoSalida(prod, sal.cantidad, op, destinoAdmin);
        });
        if (!anexarMovimientos(movs)) {
            escribir(CLAVES.farmacia, JSON.parse(snap));
            escribir(CLAVES.salidasFarmacia, listarSalidasFarmacia().filter(x => !salidas.some(s => s.salida_id === x.salida_id)));
            return { ok: false, motivo: 'No se pudo registrar la bitácora. El inventario no se modificó.' };
        }
        return { ok: true, salidas: salidas };
    }
    function aplicarPaqueteAPaciente(paqueteId, turnoId, enfermeraId, s) {
        const armado = lineasDePaquete(paqueteId);
        if (!armado.ok) return armado;
        return confirmarCarritoFarmacia({ turno_id: turnoId, enfermera_id: enfermeraId, atribuir_sesion: !enfermeraId, lineas: armado.lineas }, s);
    }

    function alertasCofeprisEnTexto(texto) {
        const n = normalizar(texto);
        if (!n) return [];
        const vistos = {}, out = [];
        listarFarmacia().forEach(p => {
            if (vistos[p.sku]) return;
            if (p.fraccion_cofepris !== 'I' && FRACCIONES_RECETA.indexOf(p.fraccion_cofepris) < 0) return;
            const tokens = [p.nombre, p.nombre_comercial].join(' ').split(/\s+/).map(normalizar).filter(w => w.length >= 6);
            const token = tokens.find(w => n.indexOf(w) >= 0);
            if (!token) return;
            vistos[p.sku] = true;
            const hoy = hoyLocal();
            const vigente = listarFarmacia().filter(x => normalizar(x.sku) === normalizar(p.sku) && x.stock > 0 && String(x.caducidad) >= hoy).sort((a, b) => String(a.caducidad).localeCompare(String(b.caducidad)))[0] || p;
            const linea = String(texto).split(/\n/).map(l => l.trim()).find(l => normalizar(l).indexOf(token) >= 0) || vigente.nombre;
            out.push(fichaNormativa(vigente, linea));
        });
        return out;
    }
    function datosReceta(op) {
        const p = op.producto || {};
        const fraccion = op.fraccion || p.fraccion_cofepris || 'NA';
        return {
            tipo: op.tipo || 'respaldo',
            titulo: op.tipo === 'individual' ? 'Receta individual de estupefaciente' : 'Receta de respaldo',
            fraccion: fraccion, etiqueta: etiquetaNormativa(fraccion) || nombreFraccionCofepris(fraccion),
            paciente: op.paciente || '', edad: op.edad || '', cama: op.cama || '',
            medico: op.medico || '', cedula: op.cedula || '',
            denominacion: op.denominacion || p.nombre || '', dosis: op.dosis || '',
            lote: op.lote || p.lote || '', laboratorio: op.laboratorio || p.laboratorio || '',
            fecha: op.fecha || new Date().toISOString(),
            numero: op.numero || null, de: op.de || null,
            folio_receta_especial: op.folio_receta_especial || '',
            datos_postanestesicos: op.datos_postanestesicos || ''
        };
    }
    function htmlRecetaImprimible(op) {
        const d = datosReceta(op);
        const e = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        const conteo = d.numero ? '<p><strong>Receta individual:</strong> ' + e(d.numero) + ' de ' + e(d.de) + '</p><p><strong>Caja / lote:</strong> ' + e(d.lote) + ' · <strong>Receta especial:</strong> ' + e(d.folio_receta_especial) + '</p>' : '';
        const post = d.datos_postanestesicos ? '<p><strong>Datos post-anestésicos:</strong> ' + e(d.datos_postanestesicos) + '</p>' : '';
        return '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>' + e(d.titulo) + '</title><style>body{font-family:Georgia,serif;color:#1e293b;margin:32px;max-width:680px}h1{font-size:20px;margin:0}h2{font-size:14px;font-weight:normal;color:#64748b;margin:4px 0 16px}.caja{border:1px solid #cbd5e1;border-radius:8px;padding:16px;margin-top:12px}p{margin:6px 0;font-size:14px}.firma{margin-top:48px;border-top:1px solid #334155;width:240px;padding-top:6px;font-size:12px}</style></head><body><h1>Sanatorio Belén</h1><h2>' + e(d.titulo) + '</h2><div class="caja"><p><strong>Paciente:</strong> ' + e(d.paciente) + (d.edad ? ' · ' + e(d.edad) : '') + (d.cama ? ' · ' + e(d.cama) : '') + '</p><p><strong>Fecha:</strong> ' + e(fechaHoraLegible(d.fecha)) + '</p><p><strong>Médico:</strong> ' + e(d.medico) + ' · <strong>Cédula:</strong> ' + e(d.cedula || 'No registrada') + '</p></div><div class="caja"><p><strong>Denominación:</strong> ' + e(d.denominacion) + '</p><p><strong>Dosis / indicación:</strong> ' + e(d.dosis || d.denominacion) + '</p><p><strong>Laboratorio:</strong> ' + e(d.laboratorio) + ' · <strong>Lote:</strong> ' + e(d.lote) + '</p><p><strong>Control normativo:</strong> ' + e(d.etiqueta) + '</p>' + conteo + post + '</div><div class="firma">Firma del médico</div></body></html>';
    }

    function semillaLotesFarmacia() {
        return [
            { lote_id: 'LOT-CEF-VIEJO', sku: 'CEF-1G', nombre: 'Ceftriaxona 1g', lote: 'L-CEF-VIEJO', caducidad: isoMasDias(-5), stock: 6, precio_unitario: 120 },
            { lote_id: 'LOT-CEF-PROX', sku: 'CEF-1G', nombre: 'Ceftriaxona 1g', lote: 'L-CEF-PROX', caducidad: isoMasDias(12), stock: 8, precio_unitario: 120 },
            { lote_id: 'LOT-CEF-1', sku: 'CEF-1G', nombre: 'Ceftriaxona 1g', lote: 'L-CEF-26A', caducidad: isoMasDias(400), stock: 40, precio_unitario: 120 },
            { lote_id: 'LOT-SOL-1', sku: 'SOL-1000', nombre: 'Solución salina 1000 ml', lote: 'L-SOL-26B', caducidad: isoMasDias(18), stock: 30, precio_unitario: 85 },
            { lote_id: 'LOT-FIS-1', sku: 'FIS-1000', nombre: 'Solución fisiológica 1000 ml', lote: 'L-FIS-26H', caducidad: isoMasDias(18), stock: 24, precio_unitario: 85 },
            { lote_id: 'LOT-PAR-1', sku: 'PAR-1G', nombre: 'Paracetamol 1g IV', lote: 'L-PAR-26C', caducidad: isoMasDias(200), stock: 3, precio_unitario: 45 },
            { lote_id: 'LOT-FEN-1', sku: 'FEN-50', nombre: 'Fentanilo 0.5 mg / 10 ml', lote: 'L-FEN-26A', caducidad: isoMasDias(500), stock: 5, precio_unitario: 180 },
            { lote_id: 'LOT-DIA-1', sku: 'DIA-10', nombre: 'Diazepam 10 mg', lote: 'L-DIA-26A', caducidad: isoMasDias(300), stock: 12, precio_unitario: 35 },
            { lote_id: 'LOT-GUA-1', sku: 'GUA-M', nombre: 'Guantes de látex talla M', lote: 'L-GUA-26A', caducidad: isoMasDias(700), stock: 40, precio_unitario: 8 },
            { lote_id: 'LOT-JER-1', sku: 'JER-10', nombre: 'Jeringa 10 ml', lote: 'L-JER-26A', caducidad: isoMasDias(700), stock: 50, precio_unitario: 6 },
            { lote_id: 'LOT-VEN-1', sku: 'VEN-18', nombre: 'Equipo de venoclisis', lote: 'L-VEN-26A', caducidad: isoMasDias(500), stock: 20, precio_unitario: 45 },
            { lote_id: 'LOT-PUN-1', sku: 'PUN-18', nombre: 'Punzocat 18G', lote: 'L-PUN-26A', caducidad: isoMasDias(500), stock: 30, precio_unitario: 18 },
            { lote_id: 'LOT-INY-1', sku: 'INY-01', nombre: 'Inyección', lote: 'L-INY-26D', caducidad: isoMasDias(300), stock: 20, precio_unitario: 80 },
            { lote_id: 'LOT-CUR-1', sku: 'CUR-01', nombre: 'Curación', lote: 'L-CUR-26E', caducidad: isoMasDias(90), stock: 15, precio_unitario: 150 },
            { lote_id: 'LOT-MAT-1', sku: 'MAT-01', nombre: 'Material', lote: 'L-MAT-26F', caducidad: isoMasDias(60), stock: 12, precio_unitario: 90 },
            { lote_id: 'LOT-SUT-1', sku: 'SUT-01', nombre: 'Material de sutura', lote: 'L-SUT-26G', caducidad: isoMasDias(120), stock: 8, precio_unitario: 210 },
            { lote_id: 'LOT-CON-1', sku: 'CON-01', nombre: 'Consulta', lote: 'L-CON-26I', caducidad: isoMasDias(365), stock: 50, precio_unitario: 500 },
            { lote_id: 'LOT-NEB-1', sku: 'NEB-01', nombre: 'Nebulización', lote: 'L-NEB-26J', caducidad: isoMasDias(180), stock: 20, precio_unitario: 180 },
            { lote_id: 'LOT-EKG-1', sku: 'EKG-01', nombre: 'Electrocardiograma', lote: 'L-EKG-26K', caducidad: isoMasDias(365), stock: 15, precio_unitario: 250 },
            { lote_id: 'LOT-DEX-1', sku: 'DEX-01', nombre: 'Dextrostix', lote: 'L-DEX-26A', caducidad: isoMasDias(180), stock: 25, precio_unitario: 65 },
            { lote_id: 'LOT-LAB-1', sku: 'LAB-BH', nombre: 'Biometría hemática', lote: 'L-LAB-26A', caducidad: isoMasDias(365), stock: 99, precio_unitario: 220 },
            { lote_id: 'LOT-RX-1', sku: 'RX-ABD', nombre: 'Rayos X de abdomen', lote: 'L-RX-26A', caducidad: isoMasDias(365), stock: 99, precio_unitario: 480 },
            { lote_id: 'LOT-IM-1', sku: 'IM-01', nombre: 'Aplicación intramuscular', lote: 'L-IM-26L', caducidad: isoMasDias(300), stock: 20, precio_unitario: 90 }
        ].map(completarLote);
    }
    function semillaPaquetesFarmacia() {
        return [
            { paquete_id: 'PAQ-CESAREA', nombre: 'Paquete Cesárea', items: [
                { sku: 'GUA-M', cantidad: 2 }, { sku: 'JER-10', cantidad: 4 }, { sku: 'VEN-18', cantidad: 1 }, { sku: 'PUN-18', cantidad: 2 },
                { sku: 'CEF-1G', cantidad: 1 }, { sku: 'SOL-1000', cantidad: 1 }, { sku: 'LAB-BH', cantidad: 1 }, { sku: 'EKG-01', cantidad: 1 }
            ] },
            { paquete_id: 'PAQ-COLE', nombre: 'Paquete Colecistectomía', items: [
                { sku: 'GUA-M', cantidad: 2 }, { sku: 'JER-10', cantidad: 3 }, { sku: 'VEN-18', cantidad: 1 }, { sku: 'PUN-18', cantidad: 1 },
                { sku: 'CEF-1G', cantidad: 1 }, { sku: 'SOL-1000', cantidad: 2 }, { sku: 'SUT-01', cantidad: 1 }, { sku: 'EKG-01', cantidad: 1 }
            ] },
            { paquete_id: 'PAQ-PARTO', nombre: 'Paquete Parto', items: [
                { sku: 'GUA-M', cantidad: 2 }, { sku: 'VEN-18', cantidad: 1 }, { sku: 'JER-10', cantidad: 2 },
                { sku: 'DEX-01', cantidad: 1 }, { sku: 'LAB-BH', cantidad: 1 }, { sku: 'SOL-1000', cantidad: 1 }
            ] }
        ];
    }
    function semillaCajaFentanilo() {
        const lote = (listarFarmacia().find(p => p.lote_id === 'LOT-FEN-1')) || productoPorSku('FEN-50');
        if (!lote) return [];
        return [{
            caja_id: 'CAJA-FEN-1', sku: lote.sku, nombre: lote.nombre, lote_id: lote.lote_id, lote: lote.lote,
            piezas_por_caja: lote.piezas_por_caja || 5, usadas: 0, folio_receta_especial: 'RE-2026-0142',
            responsable_id: 'dra_elena', responsable_nombre: (USUARIOS.dra_elena || {}).nombre || 'Dra. Elena Ríos',
            creada_en: new Date().toISOString(), usos: []
        }];
    }
    function sembrarFarmaciaSiHaceFalta() {
        if (localStorage.getItem(CLAVES.surtido) === null) escribir(CLAVES.surtido, []);
        let lista = localStorage.getItem(CLAVES.farmacia) === null ? semillaLotesFarmacia() : listarFarmacia().map(completarLote);
        if (localStorage.getItem(CLAVES.farmaciaAmpliada) === null) {
            semillaLotesFarmacia().forEach(extra => { if (!lista.some(p => p.lote_id === extra.lote_id)) lista.push(extra); });
            escribir(CLAVES.farmaciaAmpliada, true);
        }
        escribir(CLAVES.farmacia, lista);
        if (localStorage.getItem(CLAVES.paquetes) === null) escribir(CLAVES.paquetes, semillaPaquetesFarmacia());
        if (localStorage.getItem(CLAVES.cajasEstupefacientes) === null) escribir(CLAVES.cajasEstupefacientes, semillaCajaFentanilo());
        return true;
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
        sembrarUsuariosSiHaceFalta();
        completarAnestesiologoCirugias();
        sembrarFarmaciaSiHaceFalta();
        if (localStorage.getItem(CLAVES.catalogo) !== null || localStorage.getItem(CLAVES.visitas) !== null) { sembrarCirugiasSiHaceFalta(); return false; }
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
        sembrarCirugiasSiHaceFalta();
        return true;
    }

    // Borra TODA la información operativa del demo (no toca los machotes) y vuelve a sembrar
    function restablecerDemo() {
        [CLAVES.catalogo, CLAVES.turnos, CLAVES.visitas, CLAVES.borradores, CLAVES.hospitalizados, CLAVES.internamientos, CLAVES.correcciones, CLAVES.cirugias, CLAVES.farmacia, CLAVES.surtido, CLAVES.paquetes, CLAVES.cajasEstupefacientes, CLAVES.salidasFarmacia, CLAVES.movimientosFarmacia, CLAVES.ivaDiferido, CLAVES.farmaciaAmpliada, CLAVES.demo].forEach(k => localStorage.removeItem(k));   // los interruptores de personal se conservan
        return sembrarDemoSiHaceFalta();
    }

    global.BelenStore = {
        CLAVES, ESPECIALIDADES, ROLES, ENFERMERIAS, PERSONAL_OPERATIVO, USUARIOS, COLORES_DISTINTIVO, ACCIONES_PERSONAL, PERMISOS, MODULOS, ESTATUS, ETIQUETA_ESTATUS, ESTATUS_EN_FILA, RANGOS_SIGNOS, SIGNOS_OBLIGATORIOS,
        leer, escribir, normalizar, limpiarEspacios, hoyLocal, parseFechaISO, calcularEdad, fechaLegibleISO, iniciales, formatoReloj, hashContrasena, colorDeUsuario,
        iniciarSesion, sesion, cerrarSesion, puede, esEnfermeria, moduloAplicaARol, permisoModuloDe, permisoModuloExplicito, establecerPermisoModulo, permisoAccionDe, establecerPermisoAccion, restablecerPermisosPersonal, leerPermisosPersonal, especialidadPorCodigo, medicosDeEspecialidad, identificarOperadorFarmacia,
        guardarUsuario, desactivarUsuario, reactivarUsuario, eliminarUsuario, listarPapeleria, agregarDocumentoPersonal, eliminarDocumentoPersonal,
        listarPacientes, buscarPacientePorIdentidad, buscarPacientesPorNombre, buscarPacientePorId, homonimos, guardarPaciente,
        listarTurnos, obtenerTurno, actualizarTurno, siguienteNumeroTurno, crearTurno, ordenarPorLlegada, turnoVisiblePara, filaDe, colaEspera, pacientesEnConsulta, posicionEnCola, posicionNuevaEnCola, siguienteEnCola, corteDiario, metricas24h,
        listarCirugias, fichaCirugia, proximasCirugias, cirugiasVisibles, cirugiaVisiblePara, cirujanos, anestesiologos, validarCirugia, programarCirugia, hospitalizadosDe, hospitalizadoVisiblePara,
        validarSignos, signosCompletos, resumenSignos, guardarSignos,
        pasarAMedico, iniciarConsulta, accesoExpediente,
        leerBorrador, guardarBorrador, borrarBorrador,
        listarVisitas, registrarVisita, visitasDePaciente, antecedentesLongitudinales,
        listarHospitalizados, guardarHospitalizado,
        listarInternamientos, internamientoDeTurno, obtenerInternamiento, resolverInternamiento, asegurarInternamiento, sincronizarInternamiento, descartarInternamiento,
        fichaHospitalizado, accesoVisorHospitalizado, relacionMedico, tieneInterconsulta, medicosParaInterconsulta, solicitarInterconsulta,
        validarNotaEvolucion, agregarNotaEvolucion, indicacionesVigentes, agregarHojaIndicaciones, asignarCama,
        CONCEPTOS_HOSPITAL, CONCEPTOS_AMBULATORIO, formatoMoneda, validarCargo, puedeCargarConsumos, desgloseFiscal, sugerirIvaConcepto,
        agregarCargoInternamiento, agregarCargoTurno, validarNotaEgreso, registrarEgreso,
        cargosDeEpisodio, cuentasPorCobrar, fichaCuenta, cerrarExpedientePagado,
        listarInventarioFarmacia, productoPorSku, buscarLotesFarmacia, validarIngresoFarmacia, ingresarInsumo, fichasSurtidoPendiente, surtirLinea, parsearLineasSurtido,
        CATEGORIAS_FARMACIA, FRACCIONES_COFEPRIS, FORMAS_FARMACEUTICAS, VIAS_ADMINISTRACION, CONSERVACIONES, LABORATORIOS_FRECUENTES,
        nombreCategoriaFarmacia, nombreFraccionCofepris, nombreFormaFarmaceutica, nombreConservacion, textoStockFarmacia, denominacionProducto, etiquetaNormativa,
        listarPaquetes, guardarPaquete, eliminarPaquete, lineasDePaquete, aplicarPaqueteAPaciente,
        enfermerasActivas, pacientesTerminalFarmacia, prepararLineaCarrito, loteMasProximo, confirmarCarritoFarmacia,
        cajasAbiertasDe, abrirCajaEstupefaciente, listarCajasEstupefacientes, listarSalidasFarmacia, registrarRetiroAdministracion, filtrarMovimientosFarmacia, carpetasMovimientosFarmacia, csvMovimientosFarmacia, alertasCofeprisEnTexto, datosReceta, htmlRecetaImprimible,
        validarCorreccionPaciente, corregirDatosPaciente, fechaNacimientoParaEdad, fechaHoraLegible,
        sembrarDemoSiHaceFalta, restablecerDemo
    };
    sembrarUsuariosSiHaceFalta();
    completarAnestesiologoCirugias();
    sembrarFarmaciaSiHaceFalta();
    normalizarIvaDiferido();
})(window);
