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
//   belen_cirugias ............. cirugías programadas (cirugia_id PK, FK paciente_id opcional, FK medico_cirujano_id,
//                                sala QX_GRANDE|QX_CHICO, tipo_estancia AMBULATORIA|HOSPITALARIA, hora_inicio, hora_fin)
//   belen_correcciones ......... bitácora de correcciones administrativas de datos del paciente
//   belen_catalogo_farmacia .... lotes de medicamento y material de curación (sku, lote, caducidad, stock, precios)
//   belen_catalogo_estudios .... laboratorio, imagenología y procedimientos (estudio_id PK, precio oficial)
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
        estudios: 'belen_catalogo_estudios',
        surtido: 'belen_cola_surtido',
        paquetes: 'belen_paquetes_farmacia',
        cajasEstupefacientes: 'belen_cajas_estupefacientes',
        salidasFarmacia: 'belen_bitacora_salidas',
        movimientosFarmacia: 'belen_movimientos_farmacia',
        recetasFoliadas: 'belen_recetas_foliadas',
        recetas: 'belen_recetas',
        folioRecetaSeq: 'belen_folio_receta_seq',
        folioExternoSeq: 'belen_folio_externo_seq',
        demoQxActivo: 'belen_demo_qx_activo_v1',
        ivaDiferido: 'belen_iva_diferido_v1',
        farmaciaAmpliada: 'belen_farmacia_ampliada_v2',
        usuarios: 'belen_usuarios',
        papeleria: 'belen_papeleria_personal',
        demo: 'belen_demo_sembrado',
        estudiosV3: 'belen_catalogo_estudios_v3',
        cuentas: 'belen_cuentas',
        hojasEnfermeria: 'belen_hojas_enfermeria'
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
        { id: 'dr_juan',       rol: 'medico',        nombre: 'Dr. Juan Pérez',     cargo: 'Medicina General',               cedula_profesional: 'MG-11021', cedula_general: 'MG-11021', cedula_especialidad: '', cedula_subespecialidad: '', cedulas_visibles: ['general'], codigo_rapido: '1021', especialidad_codigo: 'MEDICINA_GENERAL',     costo_consulta: 400, color_distintivo: 'emerald', etiqueta_admin: 'Consulta general' },
        { id: 'dr_roberto',    rol: 'medico',        nombre: 'Dr. Roberto Flores', cargo: 'Angiología',                     cedula_profesional: 'ANG-3340', cedula_general: '', cedula_especialidad: 'ANG-3340', cedula_subespecialidad: '', cedulas_visibles: ['especialidad'], codigo_rapido: '3340', especialidad_codigo: 'ANGIOLOGIA',           costo_consulta: 800, color_distintivo: 'amber',   etiqueta_admin: 'Vascular' },
        { id: 'dr_arturo',     rol: 'medico',        nombre: 'Dr. Arturo Gómez',   cargo: 'Cirugía General',                cedula_profesional: 'CG-7781',  cedula_general: '', cedula_especialidad: 'CG-7781', cedula_subespecialidad: '', cedulas_visibles: ['especialidad'], codigo_rapido: '7781', especialidad_codigo: 'CIRUGIA_GENERAL',      costo_consulta: 800, color_distintivo: 'violet',  etiqueta_admin: 'Cirujano' },
        { id: 'dr_internista', rol: 'medico',        nombre: 'Dr. Carlos Méndez',  cargo: 'Medicina Interna',               cedula_profesional: 'MI-5520',  cedula_general: '', cedula_especialidad: 'MI-5520', cedula_subespecialidad: '', cedulas_visibles: ['especialidad'], codigo_rapido: '5520', especialidad_codigo: 'MEDICINA_INTERNA',     costo_consulta: 800, color_distintivo: 'cyan',    etiqueta_admin: 'Internista' },
        { id: 'dra_elena',     rol: 'medico',        nombre: 'Dra. Elena Ríos',    cargo: 'Anestesiología',                 cedula_profesional: 'AE-45821', cedula_general: '', cedula_especialidad: 'AE-45821', cedula_subespecialidad: '', cedulas_visibles: ['especialidad'], codigo_rapido: '4582', especialidad_codigo: 'ANESTESIOLOGIA',       costo_consulta: 800, color_distintivo: 'rose',    etiqueta_admin: 'Anestesia' }
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
        ver_expedientes_catalogo:  ['admin', 'administrador', 'medico'],
        // ---- MÓDULOS (interruptor por usuario en Gestión de Personal). El valor por defecto es el de esta matriz.
        ver_consultas:             ['admin', 'administrador', 'enf_triage', 'medico'],
        ver_hospitalizados:        ['admin', 'administrador', 'enf_hospital', 'enf_quirofano', 'medico'],
        ver_quirofano:             ['admin', 'administrador', 'enf_hospital', 'enf_quirofano', 'medico'],
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
        cargar_cuenta_consulta:    ['admin'],
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
          descripcion: 'Agenda de Quirófano Grande y Quirófano Chico. El especialista solo ve sus cirugías; el anestesiólogo, solo las suyas.' },
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

    // Dos salas físicas. El día quirúrgico va de 07:00 a 22:00; el cruce se evalúa en [inicio, fin).
    const SALAS_QUIROFANO = [
        { codigo: 'QX_GRANDE', nombre: 'Quirófano Grande (General / Especialidades)' },
        { codigo: 'QX_CHICO', nombre: 'Quirófano Chico (Gineco-Obstetricia / Menor)' }
    ];
    const DURACIONES_CIRUGIA = [
        { minutos: 30, etiqueta: '30 min' },
        { minutos: 60, etiqueta: '1 hr' },
        { minutos: 90, etiqueta: '1.5 hrs (90 min)' },
        { minutos: 120, etiqueta: '2 hrs' },
        { minutos: 150, etiqueta: '2.5 hrs' },
        { minutos: 180, etiqueta: '3 hrs' },
        { minutos: 240, etiqueta: '4+ hrs' }
    ];
    const TIPOS_ESTANCIA_QX = [
        { codigo: 'AMBULATORIA', etiqueta: 'AMBULATORIA (Entra y sale el mismo día sin cama de piso)' },
        { codigo: 'HOSPITALARIA', etiqueta: 'HOSPITALARIA (Requiere cama de hospitalización)' }
    ];
    const ESPECIALIDADES_QUIRURGICAS = ['CIRUGIA_GENERAL', 'GINECOLOGIA_OBSTETRICIA', 'TRAUMATOLOGIA_ORTOPEDIA', 'ANGIOLOGIA'];
    const QX_DIA_INICIO = 7 * 60;
    const QX_DIA_FIN = 22 * 60;
    const AREA_AMBULATORIO_QX = 'Quirófano / Recuperación Ambulatoria';
    const MODALIDAD_AMBULATORIO_QX = 'AMBULATORIO_QUIROFANO';
    const QX_TRASLADO_MINUTOS = 40;
    const UBICACION_QX = { PISO: 'PISO', EN_TRANSITO_QUIROFANO: 'EN_TRANSITO_QUIROFANO', QUIROFANO: 'QUIROFANO' };
    const CAMAS_HOSPITAL = [
        { codigo: 'HOSP-1', numero: '1', nombre: 'Hospitalización — Cama 1', area: 'HOSPITALIZACION' },
        { codigo: 'HOSP-2', numero: '2', nombre: 'Hospitalización — Cama 2', area: 'HOSPITALIZACION' },
        { codigo: 'HOSP-3', numero: '3', nombre: 'Hospitalización — Cama 3', area: 'HOSPITALIZACION' },
        { codigo: 'HOSP-4', numero: '4', nombre: 'Hospitalización — Cama 4', area: 'HOSPITALIZACION' },
        { codigo: 'HOSP-AISLADO', numero: 'Aislado', nombre: 'Hospitalización — Aislado', area: 'HOSPITALIZACION' },
        { codigo: 'OBS-1', numero: '1', nombre: 'Observación — Cama 1', area: 'OBSERVACION' },
        { codigo: 'OBS-2', numero: '2', nombre: 'Observación — Cama 2', area: 'OBSERVACION' },
        { codigo: 'CONS-1', numero: '1', nombre: 'Consultorio extra — Puesto 1', area: 'CONSULTORIO_EXTRA' },
        { codigo: 'REC-1', numero: '1', nombre: 'Recuperación — Cama 1', area: 'QUIROFANO' },
        { codigo: 'REC-2', numero: '2', nombre: 'Recuperación — Cama 2', area: 'QUIROFANO' },
        { codigo: 'REC-GINECO', numero: 'Gineco', nombre: 'Recuperación — Gineco', area: 'QUIROFANO' }
    ];
    const ALIAS_CODIGO_CAMA = {
        CAMA_1: 'HOSP-1', CAMA_2: 'HOSP-2', CAMA_3: 'HOSP-3', CAMA_4: 'HOSP-4', AISLADO: 'HOSP-AISLADO',
        OBS_1: 'OBS-1', CONS_EXTRA: 'CONS-1', REC_GEN_1: 'REC-1', REC_GEN_2: 'REC-2', REC_GINECO: 'REC-GINECO'
    };
    const ALIAS_NOMBRE_CAMA = {
        'cama 1': 'HOSP-1', 'cama 2': 'HOSP-2', 'cama 3': 'HOSP-3', 'cama 4': 'HOSP-4', aislado: 'HOSP-AISLADO',
        'observacion 1': 'OBS-1', 'consultorio extra': 'CONS-1',
        'recuperacion general 1': 'REC-1', 'recuperacion general 2': 'REC-2',
        'recuperacion gineco': 'REC-GINECO', 'recuperacion gineco-obstetrica': 'REC-GINECO'
    };
    const NOMBRES_AREA_ESTANCIA = {
        HOSPITALIZACION: 'Hospitalización', OBSERVACION: 'Observación',
        CONSULTORIO_EXTRA: 'Consultorio extra', QUIROFANO: 'Quirófano / Recuperación'
    };
    const DESTINOS_AREA_ESTANCIA = {
        HOSPITALIZACION: 'Hospitalizacion', OBSERVACION: 'Observacion',
        CONSULTORIO_EXTRA: 'ConsultorioExtra', QUIROFANO: 'Quirofano'
    };
    const TRANSICIONES_AREA = {
        CONSULTORIO_EXTRA: ['OBSERVACION', 'HOSPITALIZACION'],
        OBSERVACION: ['HOSPITALIZACION']
    };
    function resolverCama(pista) {
        if (!pista) return null;
        const crudo = String(pista).trim();
        if (ALIAS_CODIGO_CAMA[crudo]) return CAMAS_HOSPITAL.find(c => c.codigo === ALIAS_CODIGO_CAMA[crudo]) || null;
        const directo = CAMAS_HOSPITAL.find(c => c.codigo === crudo);
        if (directo) return directo;
        const n = normalizar(crudo);
        if (ALIAS_NOMBRE_CAMA[n]) return CAMAS_HOSPITAL.find(c => c.codigo === ALIAS_NOMBRE_CAMA[n]) || null;
        return CAMAS_HOSPITAL.find(c => normalizar(c.nombre) === n || normalizar(c.codigo) === n) || null;
    }
    function etiquetaCama(pista) {
        const c = resolverCama(pista);
        return c ? c.nombre : (pista ? String(pista) : '');
    }
    function nombreAreaEstancia(codigo) { return NOMBRES_AREA_ESTANCIA[codigo] || codigo || ''; }
    function codigoAreaEstancia(i, t) {
        if (i && i.area_codigo && NOMBRES_AREA_ESTANCIA[i.area_codigo]) return i.area_codigo;
        const blob = normalizar([i && i.area_destino, i && i.destino, t && t.area_destino, t && t.destino].filter(Boolean).join(' '));
        if (!blob) return '';
        if (blob.indexOf('consultorio') >= 0) return 'CONSULTORIO_EXTRA';
        if (blob.indexOf('observ') >= 0) return 'OBSERVACION';
        if (blob.indexOf('quirof') >= 0 || blob.indexOf('recuper') >= 0) return 'QUIROFANO';
        if (blob.indexOf('hospital') >= 0) return 'HOSPITALIZACION';
        return '';
    }
    function areasDestinoEstancia(codigo) { return (TRANSICIONES_AREA[codigo] || []).slice(); }
    const TECNICAS_ANESTESIA = [
        { codigo: 'GENERAL', etiqueta: 'General balanceada' },
        { codigo: 'NEUROAXIAL', etiqueta: 'Bloqueo neuroaxial/raquídeo' },
        { codigo: 'SEDACION', etiqueta: 'Sedación' },
        { codigo: 'LOCAL', etiqueta: 'Local' }
    ];
    const MEDS_ANESTESIA = [
        { sku: 'FEN-50', nombre: 'Fentanilo Fracción I', fraccion: 'I' },
        { sku: 'MID-5', nombre: 'Midazolam Fracción II', fraccion: 'II' },
        { sku: 'PRO-200', nombre: 'Propofol', fraccion: 'IV' },
        { sku: 'BUP-05', nombre: 'Bupivacaína', fraccion: 'VI' }
    ];

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
            if (copia.rol === 'medico') {
                copia.medico_id = copia.id;
                if (copia.costo_consulta === undefined || copia.costo_consulta === null || copia.costo_consulta === '') {
                    copia.costo_consulta = copia.especialidad_codigo === 'MEDICINA_GENERAL' ? 400 : 800;
                } else {
                    copia.costo_consulta = Number(copia.costo_consulta) || 0;
                }
            } else delete copia.medico_id;
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
            guardarListaUsuarios(SEMILLA_USUARIOS.map(u => Object.assign({ password_hash: hash, activo: true }, u)));
            migrarCedulasMedicos();
            return true;
        }
        const lista = listaUsuariosCruda();
        const ids = new Set(lista.map(u => u.id));
        const faltan = SEMILLA_USUARIOS.filter(u => !ids.has(u.id)).map(u => Object.assign({ password_hash: hash, activo: true }, u));
        if (faltan.length) guardarListaUsuarios(lista.concat(faltan));
        else publicarUsuarios(lista);
        completarCodigosRapidos();
        etiquetarKioscoFarmacia();
        migrarCedulasMedicos();
        return true;
    }
    const CEDULAS_FIRMA = [
        { codigo: 'general', campo: 'cedula_general', etiqueta: 'Cédula de Médico General / Licenciatura' },
        { codigo: 'especialidad', campo: 'cedula_especialidad', etiqueta: 'Cédula de Especialidad' },
        { codigo: 'subespecialidad', campo: 'cedula_subespecialidad', etiqueta: 'Cédula de Subespecialidad' }
    ];
    function esMedicoGeneral(u) {
        return !!u && u.rol === 'medico' && (u.especialidad_codigo === 'MEDICINA_GENERAL' || !u.especialidad_codigo);
    }
    function cedulaNormalizada(v) { return limpiarEspacios(v).toUpperCase(); }
    function cedulaConFormato(v) { return /^[A-Z0-9-]{4,20}$/.test(v); }
    function migrarCedulasMedicos() {
        const lista = listaUsuariosCruda();
        let cambio = false;
        lista.forEach(u => {
            if (!u || u.rol !== 'medico') return;
            const general = u.especialidad_codigo === 'MEDICINA_GENERAL' || !u.especialidad_codigo;
            if (general && !u.cedula_general && u.cedula_profesional) { u.cedula_general = u.cedula_profesional; cambio = true; }
            if (!general && !u.cedula_especialidad && u.cedula_profesional) { u.cedula_especialidad = u.cedula_profesional; cambio = true; }
            if (u.costo_consulta === undefined || u.costo_consulta === null || u.costo_consulta === '') {
                u.costo_consulta = general ? 400 : 800;
                cambio = true;
            }
            if (!Array.isArray(u.cedulas_visibles)) { u.cedulas_visibles = []; cambio = true; }
            if (general) {
                if (u.cedulas_visibles.length !== 1 || u.cedulas_visibles[0] !== 'general') { u.cedulas_visibles = ['general']; cambio = true; }
            } else if (!u.cedulas_visibles.length) {
                u.cedulas_visibles = u.cedula_especialidad ? ['especialidad'] : (u.cedula_general ? ['general'] : []);
                cambio = true;
            }
        });
        if (cambio) guardarListaUsuarios(lista);
    }
    function lineasCedulaFirma(u) {
        if (!u) return [];
        if (u.rol !== 'medico') return u.cedula_profesional ? [{ codigo: 'profesional', etiqueta: 'Cédula', valor: u.cedula_profesional }] : [];
        if (esMedicoGeneral(u)) {
            const valor = u.cedula_general || u.cedula_profesional || '';
            return valor ? [{ codigo: 'general', etiqueta: 'Cédula de Médico General / Licenciatura', valor: valor }] : [];
        }
        const registradas = CEDULAS_FIRMA.filter(c => u[c.campo]);
        let visibles = (Array.isArray(u.cedulas_visibles) ? u.cedulas_visibles : []).filter(c => registradas.some(r => r.codigo === c));
        if (!visibles.length && registradas.length) visibles = [registradas[0].codigo];
        return CEDULAS_FIRMA.filter(c => visibles.indexOf(c.codigo) >= 0 && u[c.campo]).map(c => ({ codigo: c.codigo, etiqueta: c.etiqueta, valor: u[c.campo] }));
    }
    function textoCedulasFirma(u) {
        return lineasCedulaFirma(u).map(l => l.etiqueta + ': ' + l.valor).join('\n');
    }
    function resumenCedulas(u) {
        if (!u) return '';
        if (u.rol !== 'medico') return u.cedula_profesional || '';
        return lineasCedulaFirma(u).map(l => l.valor).join(' · ') || u.cedula_profesional || '';
    }
    function guardarCedulasVisibles(usuarioId, visibles, s) {
        const u = USUARIOS[usuarioId];
        if (!u || u.rol !== 'medico') return { ok: false, motivo: 'Solo un médico tiene cédulas de firma.' };
        const propio = s && s.usuario_id === usuarioId && s.rol === 'medico';
        const admin = s && PERMISOS.gestionar_personal.includes(s.rol);
        if (!propio && !admin) return { ok: false, motivo: 'Solo el médico o la dirección pueden elegir las cédulas que se imprimen.' };
        if (esMedicoGeneral(u)) visibles = ['general'];
        const pedidas = (Array.isArray(visibles) ? visibles : []).filter(c => CEDULAS_FIRMA.some(x => x.codigo === c));
        if (!pedidas.length) return { ok: false, motivo: 'Seleccione al menos una cédula registrada para imprimir.' };
        const sinNumero = pedidas.filter(c => { const def = CEDULAS_FIRMA.find(x => x.codigo === c); return !u[def.campo]; });
        if (sinNumero.length) return { ok: false, motivo: 'Solo puede imprimir cédulas que ya están registradas. Dirección las captura en Gestión de Personal.' };
        const lista = listaUsuariosCruda();
        const row = lista.find(x => x.id === usuarioId);
        if (!row) return { ok: false, motivo: 'No se encontró al médico.' };
        row.cedulas_visibles = pedidas;
        const lineas = lineasCedulaFirma(Object.assign({}, row));
        if (lineas[0]) row.cedula_profesional = lineas[0].valor;
        return guardarListaUsuarios(lista) ? { ok: true, usuario: USUARIOS[usuarioId] } : { ok: false, motivo: 'No se pudo guardar (almacenamiento lleno o bloqueado).' };
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

    function listarUsuarios() { return Object.values(USUARIOS); }
    function especialidadPorCodigo(codigo) { return ESPECIALIDADES.find(e => e.codigo === codigo) || null; }
    function medicosActivos() { return Object.values(USUARIOS).filter(u => u.rol === 'medico' && u.activo !== false); }
    function medicosDeEspecialidad(codigo) {
        return medicosActivos().filter(u => u.especialidad_codigo === codigo);
    }
    function validarUsuario(entrada, idActual) {
        const v = {
            id: normalizar(entrada.id), nombre: limpiarEspacios(entrada.nombre), rol: entrada.rol || '',
            cargo: limpiarEspacios(entrada.cargo), cedula_profesional: cedulaNormalizada(entrada.cedula_profesional),
            cedula_general: cedulaNormalizada(entrada.cedula_general),
            cedula_especialidad: cedulaNormalizada(entrada.cedula_especialidad),
            cedula_subespecialidad: cedulaNormalizada(entrada.cedula_subespecialidad),
            cedulas_visibles: Array.isArray(entrada.cedulas_visibles) ? entrada.cedulas_visibles.filter(c => CEDULAS_FIRMA.some(x => x.codigo === c)) : [],
            especialidad_codigo: entrada.rol === 'medico' ? (entrada.especialidad_codigo || '') : null,
            costo_consulta: entrada.rol === 'medico' ? (entrada.costo_consulta !== undefined && entrada.costo_consulta !== null && String(entrada.costo_consulta).trim() !== '' ? Number(entrada.costo_consulta) : (entrada.especialidad_codigo === 'MEDICINA_GENERAL' ? 400 : 800)) : null,
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
        if (v.rol !== 'medico') {
            if (v.cedula_profesional && !cedulaConFormato(v.cedula_profesional)) errores.cedula_profesional = 'La cédula usa letras, números o guiones (4 a 20).';
        } else {
            if (!especialidadPorCodigo(v.especialidad_codigo)) errores.especialidad_codigo = 'Seleccione la especialidad.';
            CEDULAS_FIRMA.forEach(c => {
                if (v[c.campo] && !cedulaConFormato(v[c.campo])) errores[c.campo] = 'La cédula usa letras, números o guiones (4 a 20).';
            });
            const general = v.especialidad_codigo === 'MEDICINA_GENERAL';
            if (general) {
                if (!v.cedula_general) errores.cedula_general = 'El médico general requiere su cédula de licenciatura.';
                v.cedulas_visibles = ['general'];
            } else {
                const conNumero = CEDULAS_FIRMA.filter(c => v[c.campo]).map(c => c.codigo);
                if (!conNumero.length) errores.cedula_especialidad = 'Registre al menos una cédula (general, especialidad o subespecialidad).';
                else if (!v.cedulas_visibles.length) errores.cedulas_visibles = 'Seleccione al menos una cédula para imprimir.';
                v.cedulas_visibles.forEach(c => {
                    const def = CEDULAS_FIRMA.find(x => x.codigo === c);
                    if (def && !v[def.campo] && !errores[def.campo]) errores[def.campo] = 'Registre esta cédula o desmárquela de la impresión.';
                });
            }
            const primera = lineasCedulaFirma(v)[0];
            v.cedula_profesional = primera ? primera.valor : (v.cedula_general || v.cedula_especialidad || v.cedula_subespecialidad || '');
            if (!Number.isFinite(v.costo_consulta) || v.costo_consulta < 0 || v.costo_consulta > 100000) {
                errores.costo_consulta = 'Indique una tarifa de consulta válida ($0 a $100,000).';
            }
        }
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
        if (v.rol === 'medico') {
            registro.cedula_general = v.cedula_general;
            registro.cedula_especialidad = v.cedula_especialidad;
            registro.cedula_subespecialidad = v.cedula_subespecialidad;
            registro.cedulas_visibles = v.cedulas_visibles;
            registro.costo_consulta = v.costo_consulta;
        }
        if (v.password) registro.password_hash = hashContrasena(v.password);
        if (!registro.password_hash) registro.password_hash = hashContrasena('demo');
        if (idActual && idActual !== v.id) reasignarIdUsuario(idActual, v.id);
        const siguiente = idActual ? lista.map(u => u.id === idActual ? registro : u) : lista.concat([registro]);
        return guardarListaUsuarios(siguiente) ? { ok: true, usuario: USUARIOS[v.id] } : { ok: false, motivo: 'No se pudo guardar (almacenamiento lleno o bloqueado).' };
    }
    function crearUsuario(entrada, s) { return guardarUsuario(entrada, s, null); }
    function actualizarUsuario(idActual, entrada, s) { return guardarUsuario(Object.assign({}, USUARIOS[idActual] || {}, entrada, { id: (entrada && entrada.id) || idActual }), s, idActual); }
    function actualizarCostoConsultaMedico(usuarioId, costo, s) {
        if (!s || (s.rol !== 'admin' && s.rol !== 'administrador')) return { ok: false, motivo: 'Solo Dirección o Caja pueden actualizar la tarifa de consulta.' };
        const n = Number(String(costo == null ? '' : costo).replace(',', '.'));
        if (!Number.isFinite(n) || n < 0 || n > 100000) return { ok: false, motivo: 'Indique una tarifa válida ($0 a $100,000).' };
        const lista = listaUsuariosCruda();
        const u = lista.find(x => x.id === usuarioId && x.rol === 'medico');
        if (!u) return { ok: false, motivo: 'No se encontró al médico.' };
        u.costo_consulta = Math.round(n * 100) / 100;
        return guardarListaUsuarios(lista) ? { ok: true, usuario: USUARIOS[usuarioId] } : { ok: false, motivo: 'No se pudo guardar la tarifa.' };
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

    function normalizarTexto(s) { return normalizar(s); }
    function tokensNombre(texto) {
        return normalizar(texto).split(/[^a-z0-9]+/).filter(t => t.length >= 2);
    }
    function tokensCubren(consulta, nombre) {
        const q = tokensNombre(consulta);
        if (!q.length) return false;
        const n = tokensNombre(nombre);
        return q.every(t => n.some(w => w === t || w.indexOf(t) === 0 || (t.length >= 3 && w.indexOf(t) >= 0)));
    }
    function tokensExactosCubren(a, b) {
        const ta = tokensNombre(a), tb = tokensNombre(b);
        if (!ta.length || !tb.length) return false;
        return ta.every(t => tb.indexOf(t) >= 0);
    }
    function mismaIdentidadNombre(a, b) {
        const ta = tokensNombre(a), tb = tokensNombre(b);
        if (ta.length < 2 || tb.length < 2) return false;
        const corto = ta.length <= tb.length ? ta : tb;
        const largo = ta.length <= tb.length ? tb : ta;
        return corto.every(t => largo.indexOf(t) >= 0);
    }
    function pacientePorIdentidadEn(lista, nombre, fechaNacimiento) {
        if (!fechaNacimiento || tokensNombre(nombre).length < 2) return null;
        const hits = (lista || []).filter(p => {
            if (p.fecha_nacimiento !== fechaNacimiento) return false;
            const blob = [p.nombre_completo, p.nombres, p.apellido_paterno, p.apellido_materno].filter(Boolean).join(' ');
            return mismaIdentidadNombre(nombre, blob);
        });
        hits.sort((a, b) => tokensNombre(a.nombre_completo).length - tokensNombre(b.nombre_completo).length);
        return hits[0] || null;
    }
    function partesDeNombre(paciente) {
        const p = paciente || {};
        if (p.nombres || p.apellido_paterno || p.apellido_materno) {
            return { nombres: p.nombres || '', apellido_paterno: p.apellido_paterno || '', apellido_materno: p.apellido_materno || '' };
        }
        const palabras = limpiarEspacios(p.nombre_completo).split(' ').filter(Boolean);
        if (palabras.length >= 3) return { nombres: palabras.slice(0, -2).join(' '), apellido_paterno: palabras[palabras.length - 2], apellido_materno: palabras[palabras.length - 1] };
        if (palabras.length === 2) return { nombres: palabras[0], apellido_paterno: palabras[1], apellido_materno: '' };
        return { nombres: palabras[0] || '', apellido_paterno: '', apellido_materno: '' };
    }
    function nombreCanonico(datos) {
        const partes = [datos && datos.nombres, datos && datos.apellido_paterno, datos && datos.apellido_materno].map(x => limpiarEspacios(x)).filter(Boolean);
        if (partes.length) return limpiarEspacios(partes.join(' '));
        return limpiarEspacios(datos && datos.nombre_completo);
    }
    function buscarPacientePorIdentidad(nombre, fechaNacimiento) {
        return pacientePorIdentidadEn(listarPacientes(), nombre, fechaNacimiento);
    }
    function buscarPacientesPorNombre(texto, limite) {
        const qNorm = normalizar(texto);
        if (qNorm.length < 2) return [];
        const qTokens = qNorm.split(/[^a-z0-9]+/).filter(Boolean);
        if (!qTokens.length) return [];
        return listarPacientes().filter(p => {
            const blob = normalizar([p.nombre_completo, p.nombres, p.apellido_paterno, p.apellido_materno, p.curp, p.paciente_id, p.telefono].filter(Boolean).join(' '));
            const pTokens = blob.split(/[^a-z0-9]+/).filter(Boolean);
            return qTokens.every(qt => pTokens.some(pt => pt.indexOf(qt) >= 0) || blob.indexOf(qt) >= 0);
        }).slice(0, limite || 6);
    }
    function buscarPacientes(texto, limite) {
        return buscarPacientesPorNombre(texto, limite);
    }
    function buscarPacientePorId(id) { return listarPacientes().find(p => p.paciente_id === id) || null; }
    function homonimos(nombre, fechaNacimiento) {
        return listarPacientes().filter(p => mismaIdentidadNombre(nombre, p.nombre_completo) && p.fecha_nacimiento !== fechaNacimiento);
    }

    function siguienteIdPaciente(lista) {
        const max = lista.reduce((m, p) => Math.max(m, parseInt(String(p.paciente_id).replace(/\D/g, ''), 10) || 0), 0);
        return 'PAC-' + String(max + 1).padStart(6, '0');
    }

    // Crea el paciente si no existe (por nombre + fecha de nacimiento); si existe, completa/actualiza datos de contacto
    function guardarPaciente(datos) {
        datos = datos || {};
        const lista = listarPacientes();
        const nombre = nombreCanonico(datos);
        let p = datos.paciente_id ? lista.find(x => x.paciente_id === datos.paciente_id) : null;
        if (!p && nombre && datos.fecha_nacimiento) p = pacientePorIdentidadEn(lista, nombre, datos.fecha_nacimiento);
        if (!p) {
            if (!nombre || !datos.fecha_nacimiento) return null;
            p = {
                paciente_id: siguienteIdPaciente(lista),
                nombre_completo: nombre,
                fecha_nacimiento: datos.fecha_nacimiento,
                sexo: datos.sexo || null,
                creado_en: new Date().toISOString()
            };
            lista.push(p);
        }
        if (datos.nombres) p.nombres = limpiarEspacios(datos.nombres);
        if (datos.apellido_paterno) p.apellido_paterno = limpiarEspacios(datos.apellido_paterno);
        if (datos.apellido_materno) p.apellido_materno = limpiarEspacios(datos.apellido_materno);
        if (nombre && (datos.nombres || datos.apellido_paterno)) {
            const actuales = tokensNombre(p.nombre_completo);
            const nuevos = tokensNombre(nombre);
            if (!p.nombre_completo || nuevos.length >= actuales.length) p.nombre_completo = nombre;
        } else if (nombre && !p.nombre_completo) p.nombre_completo = nombre;
        ['sexo', 'estado_civil', 'telefono', 'ocupacion', 'direccion'].forEach(k => { if (datos[k]) p[k] = datos[k]; });
        p.actualizado_en = new Date().toISOString();
        escribir(CLAVES.catalogo, lista);
        return p;
    }
    function fusionarExpedientes(conservarId, absorberId, s) {
        if (!s || (s.rol !== 'admin' && s.rol !== 'administrador')) return { ok: false, motivo: 'Solo administración puede fusionar expedientes.' };
        if (!conservarId || !absorberId || conservarId === absorberId) return { ok: false, motivo: 'Elija dos expedientes distintos: el que se conserva y el duplicado.' };
        const cat = listarPacientes();
        const destino = cat.find(p => p.paciente_id === conservarId);
        const origen = cat.find(p => p.paciente_id === absorberId);
        if (!destino || !origen) return { ok: false, motivo: 'No se encontró uno de los expedientes.' };
        ['telefono', 'direccion', 'sexo', 'estado_civil', 'ocupacion', 'nombres', 'apellido_paterno', 'apellido_materno'].forEach(k => {
            if (!destino[k] && origen[k]) destino[k] = origen[k];
        });
        if (!escribir(CLAVES.catalogo, cat.filter(p => p.paciente_id !== absorberId))) return { ok: false, motivo: 'No se pudo guardar el catálogo.' };
        const turnos = listarTurnos();
        turnos.forEach(t => {
            if (t.paciente_id !== absorberId) return;
            t.paciente_id = conservarId;
            t.paciente_nombre = destino.nombre_completo;
            if (destino.fecha_nacimiento) t.fecha_nacimiento = destino.fecha_nacimiento;
            if (destino.sexo) t.sexo = destino.sexo;
        });
        escribir(CLAVES.turnos, turnos);
        const tocarExp = e => {
            if (!e || !e.meta || e.meta.paciente_id !== absorberId) return;
            e.meta.paciente_id = conservarId;
            e.paciente = e.paciente || {};
            e.paciente.nombre_completo = destino.nombre_completo;
            e.paciente.sexo = destino.sexo || e.paciente.sexo;
            e.paciente.fecha_nacimiento = destino.fecha_nacimiento || e.paciente.fecha_nacimiento;
            if (e.internamiento && e.internamiento.paciente_id === absorberId) e.internamiento.paciente_id = conservarId;
        };
        const visitas = listarVisitas(); visitas.forEach(tocarExp); escribir(CLAVES.visitas, visitas);
        const hosp = listarHospitalizados(); hosp.forEach(tocarExp); escribir(CLAVES.hospitalizados, hosp);
        const ints = leer(CLAVES.internamientos, []);
        ints.forEach(i => { if (i && i.paciente_id === absorberId) i.paciente_id = conservarId; });
        escribir(CLAVES.internamientos, ints);
        const cir = listarCirugias();
        cir.forEach(c => {
            if (c.paciente_id !== absorberId) return;
            c.paciente_id = conservarId;
            c.paciente_nombre = destino.nombre_completo;
            if (destino.fecha_nacimiento) c.fecha_nacimiento = destino.fecha_nacimiento;
        });
        escribir(CLAVES.cirugias, cir);
        const recetas = listarRecetas();
        recetas.forEach(r => {
            if (r.paciente_id !== absorberId) return;
            r.paciente_id = conservarId;
            r.paciente_nombre = destino.nombre_completo;
            if (destino.telefono) r.paciente_telefono = destino.telefono;
            if (destino.direccion) r.paciente_direccion = destino.direccion;
        });
        escribir(CLAVES.recetas, recetas);
        const cola = listarSurtido();
        cola.forEach(sol => { if (sol.paciente_id === absorberId) sol.paciente_id = conservarId; });
        escribir(CLAVES.surtido, cola);
        return { ok: true, paciente: destino, absorbido: origen.nombre_completo };
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

    function turnoActivoEnEspecialidad(pacienteId, especialidadCodigo, medicoId) {
        if (!pacienteId) return null;
        return listarTurnos().find(t =>
            t.paciente_id === pacienteId &&
            ESTATUS_EN_FILA.includes(t.estatus) &&
            ((especialidadCodigo && t.especialidad_codigo === especialidadCodigo) || (medicoId && t.medico_id === medicoId))
        ) || null;
    }
    function registrarTurno(datos, s) {
        datos = datos || {};
        const esp = especialidadPorCodigo(datos.especialidad_codigo);
        const medico = USUARIOS[datos.medico_id];
        const paciente = buscarPacientePorId(datos.paciente_id);
        if (!esp || !medico || !paciente) return { ok: false, motivo: 'Datos incompletos para registrar el turno.' };
        if (!datos.permitir_duplicado) {
            const dup = turnoActivoEnEspecialidad(paciente.paciente_id, esp.codigo, medico.medico_id);
            if (dup) {
                return {
                    ok: false,
                    duplicado: true,
                    turno_existente: dup,
                    motivo: 'Este paciente ya está en la fila de espera para esta especialidad (' + esp.nombre + ' · ' + medico.nombre + '). Si va a pasar a otra especialidad o con otro médico, selecciónelo.'
                };
            }
        }
        const t = crearTurno(Object.assign({}, datos, { permitir_duplicado: true, registrado_por: datos.registrado_por || (s && s.nombre) || null }));
        return t ? { ok: true, turno: t } : { ok: false, motivo: 'No se pudo registrar el turno.' };
    }
    function crearTurno(datos) {
        const esp = especialidadPorCodigo(datos.especialidad_codigo);
        const medico = USUARIOS[datos.medico_id];
        const paciente = buscarPacientePorId(datos.paciente_id);
        if (!esp || !medico || !paciente) return null;
        if (!datos.permitir_duplicado) {
            const dup = turnoActivoEnEspecialidad(paciente.paciente_id, esp.codigo, medico.medico_id);
            if (dup) return null;
        }
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
        if (s.rol === 'enf_quirofano') return pacienteEnFlujoQuirofano(turno);
        if (s.rol === 'admin' || s.rol === 'administrador' || esEnfermeria(s.rol)) return true;
        if (s.rol === 'medico') {
            if (turno.medico_id === s.medico_id || tieneInterconsulta(turno.turno_id, s.medico_id)) return true;
            return s.especialidad_codigo === 'ANESTESIOLOGIA' && pacienteAsignadoAnestesia(turno, s.medico_id);
        }
        return false;
    }
    function pacienteEnFlujoQuirofano(turno) {
        if (!turno) return false;
        const i = internamientoDeTurno(turno.turno_id);
        if (turno.modalidad === MODALIDAD_AMBULATORIO_QX || (i && i.modalidad === MODALIDAD_AMBULATORIO_QX)) return true;
        const u = ubicacionDe(i);
        return u === UBICACION_QX.EN_TRANSITO_QUIROFANO || u === UBICACION_QX.QUIROFANO;
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
        const ingresoDirectoQx = t => t.modalidad === MODALIDAD_AMBULATORIO_QX || t.sin_nota_consulta;
        const consultas = turnos.filter(t => !ingresoDirectoQx(t) && !ESTATUS_EN_ESPERA.includes(t.estatus) && inicioConsulta(t) >= desde);
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
        talla_m:                 { min: 0.3, max: 2.6, entero: false, etiqueta: 'Talla', unidad: 'm', opcional: true },
        glucemia:                { min: 20,  max: 600, entero: true,  etiqueta: 'Glucosa capilar (Dxtx)', unidad: 'mg/dL', opcional: true }
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
        return { ta: ta, fc: sv.frecuencia_cardiaca ?? '--', fr: sv.frecuencia_respiratoria ?? '--', temp: sv.temperatura_c ?? '--', spo2: sv.spo2_porcentaje ?? '--', glucemia: sv.glucemia ?? '--' };
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
            if (ESTATUS_EN_FILA.includes(turno.estatus) && turno.estatus !== ESTATUS.EN_CONSULTA) {
                iniciarConsulta(turno.turno_id, s);
                turno = obtenerTurno(turno.turno_id) || turno;
            }
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
    function piezasClinicasPaciente(pacienteId, excluirTurnoId) {
        const piezas = [];
        visitasDePaciente(pacienteId).forEach(v => {
            const turnoId = (v.meta || {}).turno_id || null;
            if (excluirTurnoId && turnoId === excluirTurnoId) return;
            const fecha = (v.consulta || {}).fecha_hora || (v.meta || {}).generado_en || '';
            const medico = (v.meta || {}).medico_nombre || (v.consulta || {}).medico_tratante || '';
            const visitaId = (v.meta || {}).visita_id || fecha || piezas.length;
            const base = { fecha: fecha, medico: medico, visita: v, turno_id: turnoId };
            piezas.push(Object.assign({ id: 'consulta-' + visitaId, tipo: 'consulta', titulo: 'Nota de Consulta / Ingreso' }, base));
            piezas.push(Object.assign({ id: 'historia-' + visitaId, tipo: 'historia', titulo: 'Historia Clínica' }, base));
        });
        listarInternamientos().forEach(i => {
            const t = obtenerTurno(i.turno_id);
            if (!t || t.paciente_id !== pacienteId) return;
            if (excluirTurnoId && i.turno_id === excluirTurnoId) return;
            (i.notas_evolucion || []).forEach(n => piezas.push({ id: n.nota_id, tipo: 'evolucion', titulo: 'Nota de Evolución (SOAP)', fecha: n.fecha_hora, medico: n.autor_nombre || '', nota: n }));
            (i.notas_postoperatorias || []).forEach(n => piezas.push({ id: n.nota_id, tipo: 'postoperatoria', titulo: 'Nota Post-Quirúrgica', fecha: n.fecha_hora, medico: n.autor_nombre || '', nota: n }));
            (i.notas_postanestesicas || []).forEach(n => piezas.push({ id: n.nota_id, tipo: 'postanestesica', titulo: 'Nota Post-Anestésica', fecha: n.fecha_hora, medico: n.autor_nombre || '', nota: n }));
            if (i.nota_egreso) piezas.push({ id: i.nota_egreso.nota_id, tipo: 'egreso', titulo: 'Nota de Egreso', fecha: i.nota_egreso.fecha_hora, medico: i.nota_egreso.autor_nombre || '', nota: i.nota_egreso });
        });
        const ordenPieza = { consulta: 1, historia: 2, evolucion: 3, postoperatoria: 4, postanestesica: 5, egreso: 6 };
        piezas.sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')) || (ordenPieza[a.tipo] || 9) - (ordenPieza[b.tipo] || 9));
        return piezas;
    }

    // Autollenado longitudinal: última visita + cirugías confirmadas en episodios anteriores
    function antecedentesLongitudinales(pacienteId, excluirTurnoId) {
        const visitas = visitasDePaciente(pacienteId).filter(v => !excluirTurnoId || (v.meta && v.meta.turno_id !== excluirTurnoId));
        const ultima = visitas[0] || null;
        const vistos = new Set();
        const cirugias = [];
        const agregar = (procedimiento, fechaTexto, complicaciones, origen) => {
            const clave = normalizar(procedimiento);
            if (!clave || vistos.has(clave)) return;
            vistos.add(clave);
            const comp = limpiarEspacios(complicaciones || '') || 'Ninguna';
            cirugias.push({ procedimiento: limpiarEspacios(procedimiento), fecha_texto: fechaTexto || null, complicaciones: comp, origen: origen });
        };
        listarInternamientos().forEach(i => {
            if (!i || i.estatus === 'descartado' || i.paciente_id !== pacienteId) return;
            if (excluirTurnoId && i.turno_id === excluirTurnoId) return;
            (i.notas_postoperatorias || []).forEach(n => {
                const comp = limpiarEspacios(n.complicaciones || n.hallazgos || '') || 'Ninguna';
                agregar(n.operacion, n.fecha_hora ? fechaHoraLegible(n.fecha_hora) : null, comp, 'nota_postoperatoria');
            });
        });
        if (ultima) {
            (((ultima.antecedentes || {}).personales_patologicos || {}).cirugias_previas || [])
                .forEach(q => agregar(q.procedimiento, q.fecha_texto, q.complicaciones || 'Ninguna', 'antecedente'));
        }
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
            hoja_id: uid('IM'), folio: 'IND-' + pad3(hojas.length + 1), fecha_hora: fechaHora || new Date().toISOString(), fecha_dia: hoyLocal(), origen: origen,
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
                const icForm = datos.indicaciones.interconsulta;
                if (icForm && icForm.solicitada && icForm.medico && icForm.medico.codigo) {
                    const medId = icForm.medico.codigo;
                    const uMed = USUARIOS[medId] || Object.values(USUARIOS).find(u => u.id === medId || u.medico_id === medId);
                    const realId = (uMed && (uMed.medico_id || uMed.id)) || medId;
                    i.interconsultas = i.interconsultas || [];
                    if (!i.interconsultas.some(x => x.medico_id === realId)) {
                        i.interconsultas.push({
                            interconsulta_id: uid("IC"),
                            especialidad_codigo: (icForm.especialidad && icForm.especialidad.codigo) || (uMed && uMed.especialidad_codigo) || "ESPECIALIDAD",
                            especialidad: (icForm.especialidad && icForm.especialidad.descripcion) || (uMed && uMed.cargo) || "Especialidad",
                            medico_id: realId,
                            medico_nombre: (uMed && uMed.nombre) || icForm.medico.nombre || realId,
                            solicitada_por_id: t.medico_id,
                            solicitada_por_nombre: t.medico_nombre,
                            fecha_hora: new Date().toISOString()
                        });
                    }
                }
                const textos = textosIndicaciones(datos.indicaciones);
                const hojas = i.hojas_indicaciones || [];
                const primera = hojas.find(h => h.origen === 'ingreso');
                const autor = { id: t.medico_id, nombre: t.medico_nombre, relacion: 'tratante' };
                if (!primera) {
                    hojaParaFarmacia = nuevaHojaIndicaciones([], 'ingreso', textos, autor, (datos.consulta && datos.consulta.fecha_hora) || null);
                    anotarCoberturaIndicacion(hojaParaFarmacia);
                    i.hojas_indicaciones = hojas;
                    i.hojas_indicaciones.unshift(hojaParaFarmacia);
                } else if (hojas.length === 1) {
                    previaParaFarmacia = { medicamentos: primera.medicamentos, soluciones_parenterales: primera.soluciones_parenterales };
                    Object.assign(primera, textos);
                    anotarCoberturaIndicacion(primera);
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
            cama: i ? etiquetaCama(i.cama_codigo || i.cama) : null,
            alergias: i && i.alergias !== undefined ? i.alergias : alergiasDeBorrador(turno.turno_id),
            medico_tratante_id: turno.medico_id, medico_tratante: turno.medico_nombre, especialidad: turno.especialidad,
            diagnostico_actual: (i && i.diagnostico_actual) || turno.dx_principal || null,
            interconsultas: i ? (i.interconsultas || []) : [],
            notas: i ? (i.notas_evolucion || []).length : 0,
            estatus: turno.estatus, finalizado: turno.estatus === ESTATUS.INTERNADO,
            pendiente_pago: turno.estatus === ESTATUS.ALTA_PENDIENTE_PAGO,
            cuenta_actual: i ? Number(i.cuenta_actual || 0) : Number(turno.cuenta_actual || 0),
            area: (i && i.area_destino) || turno.area_destino || null, destino: (i && i.destino) || turno.destino || null,
            modalidad: (i && i.modalidad) || turno.modalidad || null,
            ambulatorio_qx: ((i && i.modalidad) || turno.modalidad) === MODALIDAD_AMBULATORIO_QX,
            relacion: relacionMedico(i, turno, s),
            flujo_qx: flujoQuirofanoDe(turno, i, s)
        };
    }

    // Quién puede abrir el visor expediente.html?modo=hospitalizado&turno=... (también acepta internamiento_id)
    function accesoVisorHospitalizado(s, i) {
        if (!s) return { ok: false, motivo: 'Inicie sesión para continuar.' };
        if (!i) return { ok: false, motivo: 'No se encontró el internamiento solicitado.' };
        const t = obtenerTurno(i.turno_id);
        if (!t) return { ok: false, motivo: 'No se encontró el episodio del paciente.' };
        const caja = s.rol === 'administrador' && (PERMISOS.cargar_consumos.includes(s.rol) || PERMISOS.ver_cuentas_cobrar.includes(s.rol));
        const ambQx = i.modalidad === MODALIDAD_AMBULATORIO_QX;
        const enfQxAmb = s.rol === 'enf_quirofano' && ambQx;
        if (s.rol !== 'admin' && !caja && !enfQxAmb && !permisoModuloDe(s.usuario_id, 'ver_hospitalizados')) return { ok: false, motivo: 'Su perfil no tiene habilitado el módulo de Hospitalizados.' };
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
        SIGNOS_OBLIGATORIOS.concat(['peso_kg', 'talla_m', 'glucemia']).forEach(c => { signos[c] = sv.valores[c] === undefined ? null : sv.valores[c]; });
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
        anotarCoberturaIndicacion(hoja);
        i.hojas_indicaciones = (i.hojas_indicaciones || []).concat([hoja]);
        if (!guardarInternamiento(i)) return { ok: false, motivo: 'No se pudo guardar (almacenamiento lleno o bloqueado).' };
        encolarSurtidoIndicacion(i, hoja, vig);
        return { ok: true, hoja: hoja };
    }

    // ---- Cama (la asigna Enfermería o Administración desde el Monitor de Camas)
    function asignarCama(turnoId, codigo, s) {
        if (!s || !permisoAccionDe(s.usuario_id, 'asignar_cama')) return { ok: false, motivo: 'Su perfil no puede asignar camas.' };
        const i = asegurarInternamiento(turnoId);
        const t = obtenerTurno(turnoId);
        if (!i || !t || (t.estatus !== ESTATUS.INTERNADO && t.estatus !== ESTATUS.INTERNADO_EN_PROCESO)) return { ok: false, motivo: 'Solo se asigna cama a un paciente hospitalizado.' };
        const area = codigoAreaEstancia(i, t);
        if (!area) return { ok: false, motivo: 'Este paciente no tiene un área de estancia. Use Cambiar Área.' };
        const cama = resolverCama(codigo);
        if (!cama || cama.area !== area) return { ok: false, motivo: 'Elija una cama libre de ' + nombreAreaEstancia(area) + '.' };
        const ocupada = camaEstaOcupada(cama, i.internamiento_id);
        if (ocupada) { const o = obtenerTurno(ocupada.turno_id); return { ok: false, motivo: cama.nombre + ' ya está ocupada' + (o ? ' por ' + o.paciente_nombre : '') + '.' }; }
        i.area_codigo = area;
        i.cama_codigo = cama.codigo;
        i.cama = cama.nombre;
        return guardarInternamiento(i) ? { ok: true, internamiento: obtenerInternamiento(i.internamiento_id) } : { ok: false, motivo: 'No se pudo guardar (almacenamiento lleno o bloqueado).' };
    }
    function puedeCambiarArea(s) {
        return !!s && (s.rol === 'admin' || s.rol === 'administrador' || permisoAccionDe(s.usuario_id, 'asignar_cama'));
    }
    function cambiarAreaEstancia(turnoId, areaNueva, codigoCama, s) {
        if (!puedeCambiarArea(s)) return { ok: false, motivo: 'Su perfil no puede cambiar el área de estancia.' };
        const i = asegurarInternamiento(turnoId);
        const t = obtenerTurno(turnoId);
        if (!i || !t || t.estatus !== ESTATUS.INTERNADO) return { ok: false, motivo: 'Solo se cambia el área de un paciente internado.' };
        const actual = codigoAreaEstancia(i, t);
        const permitidas = areasDestinoEstancia(actual);
        if (permitidas.indexOf(areaNueva) < 0) return { ok: false, motivo: 'Desde ' + (nombreAreaEstancia(actual) || 'esta área') + ' solo puede pasar a ' + (permitidas.map(nombreAreaEstancia).join(' o ') || 'ninguna otra área por este botón') + '.' };
        const cama = resolverCama(codigoCama);
        if (!cama || cama.area !== areaNueva) return { ok: false, motivo: 'Elija una cama libre de ' + nombreAreaEstancia(areaNueva) + '.' };
        const ocupada = camaEstaOcupada(cama, i.internamiento_id);
        if (ocupada) { const o = obtenerTurno(ocupada.turno_id); return { ok: false, motivo: cama.nombre + ' ya está ocupada' + (o ? ' por ' + o.paciente_nombre : '') + '.' }; }
        i.area_codigo = areaNueva;
        i.area_destino = nombreAreaEstancia(areaNueva);
        i.cama_codigo = cama.codigo;
        i.cama = cama.nombre;
        i.ubicacion = areaNueva === 'QUIROFANO' ? UBICACION_QX.QUIROFANO : UBICACION_QX.PISO;
        if (!guardarInternamiento(i)) return { ok: false, motivo: 'No se pudo cambiar el área.' };
        actualizarTurno(t.turno_id, { area_destino: i.area_destino, destino: DESTINOS_AREA_ESTANCIA[areaNueva] || t.destino });
        return { ok: true, internamiento: obtenerInternamiento(i.internamiento_id), area: areaNueva };
    }
    function previewCorteEstancia(turnoId) {
        const t = obtenerTurno(turnoId);
        const i = internamientoDeTurno(turnoId);
        if (!t || !i || (t.estatus !== ESTATUS.INTERNADO && t.estatus !== ESTATUS.INTERNADO_EN_PROCESO)) return { ok: false, motivo: 'El paciente no está en una estancia activa.' };
        const area = codigoAreaEstancia(i, t);
        const mapa = area === 'HOSPITALIZACION' ? { codigo: 'HOSP-NOCHE', concepto: 'Día / Noche de Hospitalización' }
            : area === 'OBSERVACION' ? { codigo: 'OBS-ESTANCIA', concepto: 'Estancia en Observación' }
            : area === 'QUIROFANO' ? { codigo: 'REC-ESTANCIA', concepto: 'Estancia en Recuperación' }
            : null;
        if (!mapa) return { ok: false, motivo: 'Consultorio extra no tiene corte de estancia. Cambie el área a Observación o Hospitalización.' };
        const est = estudioPorCodigo(mapa.codigo);
        if (!est) return { ok: false, motivo: 'El concepto de estancia no está en el tarifario.' };
        return { ok: true, area: area, area_nombre: nombreAreaEstancia(area), concepto: mapa.concepto, codigo: mapa.codigo, precio: est.precio_unitario, estudio: est };
    }
    function aplicarCorteEstancia(turnoId, entrada, s) {
        if (!s || (s.rol !== 'admin' && s.rol !== 'administrador')) return { ok: false, motivo: 'Solo administración y caja pueden aplicar el corte de estancia.' };
        const prev = previewCorteEstancia(turnoId);
        if (!prev.ok) return prev;
        let precio = prev.precio;
        if (entrada && entrada.precio != null && entrada.precio !== '') {
            const n = Math.round(Number(entrada.precio) * 100) / 100;
            if (!isFinite(n) || n <= 0) return { ok: false, motivo: 'Indique un importe mayor a cero.' };
            precio = n;
        }
        const t = obtenerTurno(turnoId);
        const cargo = cargoDesdeEstudio(prev.estudio, 1, { id: s.usuario_id, nombre: s.nombre }, {
            precio_alterado: precio !== prev.precio, precio_unitario: precio,
            observaciones: 'Corte de estancia aplicado por ' + s.nombre
        });
        cargo.concepto = prev.concepto;
        return anexarCargosEstudios(t, [cargo]);
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
        if (s && s.rol === 'medico') return { ok: false, motivo: 'Durante la consulta, los insumos y medicamentos los carga Enfermería desde Farmacia o desde la terminal de estudios.' };
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
    function liberarConsultaACaja(turnoId, s) {
        const ses = s || sesion();
        if (!ses || (ses.rol !== 'medico' && ses.rol !== 'admin' && ses.rol !== 'administrador')) {
            return { ok: false, motivo: 'Solo el médico tratante o Administración pueden liberar el paciente a Caja.' };
        }
        const t = obtenerTurno(turnoId);
        if (!t) return { ok: false, motivo: 'No se encontró la consulta.' };
        if (ses.rol === 'medico' && t.medico_id !== ses.medico_id) {
            return { ok: false, motivo: 'Solo el médico asignado puede liberar este paciente a Caja.' };
        }
        const medico = USUARIOS[t.medico_id] || {};
        const tarifa = (medico.costo_consulta !== undefined && medico.costo_consulta !== null)
            ? Number(medico.costo_consulta)
            : (t.especialidad_codigo === 'MEDICINA_GENERAL' ? 400 : 800);
        const cargos = (t.cargos || []).slice();
        const yaTieneConsulta = cargos.some(c => c && (c.origen === 'consulta_medica' || /consulta m[eé]dica/i.test(c.concepto || '')));
        const ahora = new Date().toISOString();
        if (!yaTieneConsulta && tarifa > 0) {
            cargos.unshift({
                cargo_id: uid('CG'),
                concepto: 'Consulta Médica · ' + (medico.nombre || t.medico_nombre || 'Médico'),
                categoria: 'CONSULTA',
                origen: 'consulta_medica',
                origen_precio: 'medico',
                cantidad: 1,
                precio_unitario: redondearMoneda(tarifa),
                subtotal: redondearMoneda(tarifa),
                aplica_iva: false,
                fecha_hora: ahora,
                cargado_en: ahora,
                cargado_por_id: ses.usuario_id,
                cargado_por_nombre: ses.nombre
            });
        }
        const total = totalCargos(cargos);
        const actualizado = actualizarTurno(turnoId, {
            cargos: cargos,
            cuenta_actual: total,
            cuenta_actual_total: total,
            lista_para_cobro: true,
            estatus_cuenta: 'LISTA_PARA_COBRO',
            liberada_caja_en: ahora,
            liberada_caja_por: ses.nombre
        });
        const mapCuentas = leer(CLAVES.cuentas, {}) || {};
        mapCuentas[turnoId] = {
            turno_id: turnoId,
            paciente_id: t.paciente_id,
            paciente_nombre: t.paciente_nombre,
            medico_id: t.medico_id,
            medico_nombre: t.medico_nombre,
            estatus_cuenta: 'LISTA_PARA_COBRO',
            total: total,
            liberada_en: ahora,
            cargos: cargos
        };
        escribir(CLAVES.cuentas, mapCuentas);
        return { ok: true, turno: actualizado, total: total, cargos: cargos };
    }
    function cuentasPorCobrar(s) {
        if (!s || !PERMISOS.ver_cuentas_cobrar.includes(s.rol)) return [];
        return listarTurnos()
            .filter(t => t.estatus === ESTATUS.ALTA_PENDIENTE_PAGO || ((t.lista_para_cobro || t.liberado_a_caja) && !t.cuenta_pagada && t.estatus !== ESTATUS.CERRADO_HISTORICO))
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
            origen: i ? 'hospitalizacion' : 'ambulatorio', cama: i ? etiquetaCama(i.cama_codigo || i.cama) : null,
            diagnostico: (i && (i.diagnostico_actual || i.diagnostico_ingreso)) || turno.dx_principal || null,
            cargos: cargos, total: total, cuenta_actual: total, cuenta_actual_total: total, estatus: turno.estatus,
            egreso_en: (i && i.egreso_en) || turno.actualizado_en || null
        };
    }
    function cerrarExpedientePagado(turnoId, s, opciones) {
        if (!s || !PERMISOS.cerrar_expediente_pago.includes(s.rol)) return { ok: false, motivo: 'Solo Administración puede cerrar el expediente por pago.' };
        const t = obtenerTurno(turnoId);
        if (!t) return { ok: false, motivo: 'No se encontró el episodio.' };
        const esPreCobroConsulta = t.estatus !== ESTATUS.ALTA_PENDIENTE_PAGO && !!t.lista_para_cobro && !t.cuenta_pagada;
        if (t.estatus !== ESTATUS.ALTA_PENDIENTE_PAGO && !esPreCobroConsulta) return { ok: false, motivo: 'Este expediente no está pendiente de pago.' };
        const ahora = new Date().toISOString();
        const opFiscal = opciones && (opciones.modo_iva || opciones.base_gravable_manual != null) ? { modo: opciones.modo_iva, base_manual: opciones.base_gravable_manual } : fiscalOpcionesDeTurno(t);
        const fiscal = desgloseFiscal(cargosDeEpisodio(t), !!(opciones && opciones.requirio_factura), opFiscal);
        const pago = { requirio_factura: fiscal.requirio_factura, iva_cobrado: fiscal.iva, total_pagado: fiscal.total, subtotal_base: fiscal.subtotal, modo_iva: fiscal.modo_iva, base_gravable: fiscal.base_gravable, cuenta_pagada: true, pagada_en: ahora, pagada_por_id: s.usuario_id, pagada_por_nombre: s.nombre, lista_para_cobro: false, estatus_cuenta: 'PAGADA' };
        const mapCuentas = leer(CLAVES.cuentas, {}) || {};
        if (mapCuentas[turnoId]) { mapCuentas[turnoId].estatus_cuenta = 'PAGADA'; mapCuentas[turnoId].pagada_en = ahora; mapCuentas[turnoId].pago = pago; escribir(CLAVES.cuentas, mapCuentas); }
        if (esPreCobroConsulta) {
            const cobradoEnCurso = actualizarTurno(turnoId, pago);
            return { ok: true, turno: cobradoEnCurso, pre_cobro: true };
        }
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
        const choque = cat.find(x => x.paciente_id !== pacienteId && mismaIdentidadNombre(x.nombre_completo, r.valores.nombre) && x.fecha_nacimiento === nuevaFN);
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
    // cirugia_id PK, paciente_id FK opcional, sala (QX_GRANDE | QX_CHICO), tipo_estancia (AMBULATORIA | HOSPITALARIA),
    // fecha (YYYY-MM-DD), hora_inicio, hora_fin, duracion_minutos, fecha_hora (ISO de inicio),
    // medico_cirujano_id, anestesiologo_id opcional (null = pendiente), indicaciones_preoperatorias, notas, estatus.
    // El rango ocupado es [hora_inicio, hora_fin). Nombre y fecha de nacimiento se leen del catálogo si hay paciente_id.
    function listarCirugias() { return leer(CLAVES.cirugias, []); }
    function salaPorCodigo(codigo) { return SALAS_QUIROFANO.find(x => x.codigo === codigo) || null; }
    function duracionPorMinutos(n) { return DURACIONES_CIRUGIA.find(x => x.minutos === Number(n)) || null; }
    function fechaLocalDeDate(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function minutosDeHora(hhmm) {
        const m = String(hhmm || '').match(/^(\d{2}):(\d{2})$/);
        if (!m) return null;
        const h = +m[1], min = +m[2];
        if (h > 23 || min > 59) return null;
        return h * 60 + min;
    }
    function horaDeMinutos(mins) {
        const m = ((mins % 1440) + 1440) % 1440;
        return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    }
    function fechaDeCirugia(c) {
        if (c && /^\d{4}-\d{2}-\d{2}$/.test(c.fecha || '')) return c.fecha;
        const d = new Date(c && c.fecha_hora);
        return isNaN(d.getTime()) ? '' : fechaLocalDeDate(d);
    }
    function minutosInicioCirugia(c) {
        const directo = minutosDeHora(c && c.hora_inicio);
        if (directo !== null) return directo;
        const d = new Date(c && c.fecha_hora);
        return isNaN(d.getTime()) ? null : d.getHours() * 60 + d.getMinutes();
    }
    function minutosFinCirugia(c) {
        const directo = minutosDeHora(c && c.hora_fin);
        if (directo !== null && c.hora_fin) return directo;
        const ini = minutosInicioCirugia(c);
        if (ini === null) return null;
        return ini + (parseInt(c.duracion_minutos, 10) || 90);
    }
    function estructurarCirugia(c) {
        const d = new Date(c.fecha_hora);
        const valida = !isNaN(d.getTime());
        if (!salaPorCodigo(c.sala)) c.sala = 'QX_GRANDE';
        if (c.tipo_estancia !== 'AMBULATORIA' && c.tipo_estancia !== 'HOSPITALARIA') c.tipo_estancia = 'HOSPITALARIA';
        if (!duracionPorMinutos(c.duracion_minutos)) c.duracion_minutos = 90;
        if (!c.fecha && valida) c.fecha = fechaLocalDeDate(d);
        if (!c.hora_inicio && valida) c.hora_inicio = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        const ini = minutosDeHora(c.hora_inicio);
        if (ini !== null && !c.hora_fin) c.hora_fin = horaDeMinutos(ini + Number(c.duracion_minutos));
        if (c.indicaciones_preoperatorias == null) c.indicaciones_preoperatorias = '';
        if (c.notas == null) c.notas = '';
        return c;
    }
    function finEpochCirugia(c) {
        const base = Date.parse(c.fecha_hora);
        if (!Number.isFinite(base)) return 0;
        return base + (parseInt(c.duracion_minutos, 10) || 0) * 60000;
    }
    function mismoPacienteCirugia(c, t) {
        if (!c || !t) return false;
        if (c.paciente_id && t.paciente_id === c.paciente_id) return true;
        const nombre = c.paciente_nombre || c.nombre;
        return !!nombre && normalizar(t.paciente_nombre) === normalizar(nombre);
    }
    function pacienteInternadoActivo(c) {
        return listarTurnos().some(t => (t.estatus === ESTATUS.INTERNADO || t.estatus === ESTATUS.INTERNADO_EN_PROCESO) && mismoPacienteCirugia(c, t));
    }
    function medicoInterconsultadoEnCirugia(c, medicoId) {
        if (!c || !medicoId || !c.paciente_id) return false;
        return listarInternamientos().some(i => i.paciente_id === c.paciente_id && i.estatus !== 'descartado' && (i.interconsultas || []).some(x => x.medico_id === medicoId));
    }
    function fichaCirugia(c) {
        const p = c.paciente_id ? buscarPacientePorId(c.paciente_id) : null;
        const nombre = p ? p.nombre_completo : c.paciente_nombre, fn = p ? p.fecha_nacimiento : c.fecha_nacimiento;
        const m = USUARIOS[c.medico_cirujano_id];
        const a = c.anestesiologo_id ? USUARIOS[c.anestesiologo_id] : null;
        const d = new Date(c.fecha_hora);
        const valida = !isNaN(d.getTime());
        const sala = salaPorCodigo(c.sala);
        const dur = duracionPorMinutos(c.duracion_minutos);
        const horaIni = c.hora_inicio || (valida ? String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') : '');
        const horaFin = c.hora_fin || '';
        return {
            cirugia_id: c.cirugia_id, paciente_id: c.paciente_id || null, nombre: nombre, fecha_nacimiento: fn, edad: calcularEdad(fn),
            procedimiento: c.procedimiento, fecha_hora: c.fecha_hora, estatus: c.estatus,
            fecha: fechaDeCirugia(c),
            fecha_texto: valida ? d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '',
            hora_texto: horaIni && horaFin ? horaIni + ' a ' + horaFin : (valida ? d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : ''),
            hora_inicio: horaIni, hora_fin: horaFin, duracion_minutos: Number(c.duracion_minutos) || null, duracion_texto: dur ? dur.etiqueta : '',
            sala: c.sala || null, sala_nombre: sala ? sala.nombre : '',
            tipo_estancia: c.tipo_estancia || null,
            medico_cirujano_id: c.medico_cirujano_id, medico_cirujano: m ? m.nombre : c.medico_cirujano_nombre,
            medico_especialidad: m ? m.cargo : null,
            anestesiologo_id: c.anestesiologo_id || null, anestesiologo: a ? a.nombre : (c.anestesiologo_nombre || ''),
            anestesiologo_pendiente: !c.anestesiologo_id,
            indicaciones_preoperatorias: c.indicaciones_preoperatorias || '', notas: c.notas || '',
            turno_id: c.turno_id || null, ingresado_en: c.ingresado_en || null,
            ingresada: !!(c.turno_id || c.ingresado_en), ya_internado: pacienteInternadoActivo(c),
            en_cirugia: enCirugiaDeProgramacion(c)
        };
    }
    function pacienteAsignadoAnestesia(turno, medicoId) {
        if (!turno || !medicoId) return false;
        return listarCirugias().some(c => c.estatus !== 'cancelada' && c.anestesiologo_id === medicoId && mismoPacienteCirugia(c, turno));
    }
    // admin, administrador y enf_quirofano ven toda la agenda. enf_hospital, solo las de sus pacientes internados.
    // El especialista ve las suyas o donde está interconsultado. Anestesiología solo donde está asignada.
    function cirugiaVisiblePara(c, s) {
        if (!s || !c) return false;
        if (s.rol === 'admin' || s.rol === 'administrador' || s.rol === 'enf_quirofano') return true;
        if (s.rol === 'enf_hospital') return pacienteInternadoActivo(c);
        if (s.rol !== 'medico') return false;
        if (s.especialidad_codigo === 'ANESTESIOLOGIA') return c.anestesiologo_id === s.medico_id;
        if (c.medico_cirujano_id === s.medico_id) return true;
        return medicoInterconsultadoEnCirugia(c, s.medico_id);
    }
    function cirugiasVisibles(s, ahora) {
        return proximasCirugias(ahora).filter(c => cirugiaVisiblePara(c, s));
    }
    function cirugiaPara(id, s) {
        const c = listarCirugias().find(x => x.cirugia_id === id);
        if (!c || !cirugiaVisiblePara(c, s)) return null;
        return fichaCirugia(c);
    }
    // Sigue en agenda mientras no haya terminado la duración estimada.
    function proximasCirugias(ahora) {
        const t0 = (ahora ? new Date(ahora) : new Date()).getTime();
        return listarCirugias().filter(c => c.estatus === 'programada' && finEpochCirugia(c) >= t0)
            .sort((a, b) => Date.parse(a.fecha_hora) - Date.parse(b.fecha_hora)).map(fichaCirugia);
    }
    function cirujanos() { return medicosActivos().filter(u => u.especialidad_codigo !== 'ANESTESIOLOGIA'); }
    function anestesiologos() { return medicosDeEspecialidad('ANESTESIOLOGIA'); }
    function puedeIngresarAmbulatorio(s) {
        return !!s && (s.rol === 'admin' || s.rol === 'administrador' || s.rol === 'enf_quirofano');
    }
    // Tramos de 07:00 a 22:00. Si quien programa es médico, el ocupado no lleva paciente, cirujano ni procedimiento.
    function disponibilidadQuirofano(sala, fecha, s) {
        if (!salaPorCodigo(sala) || !parseFechaISO(fecha)) return { ok: false, tramos: [] };
        const ocultar = !s || s.rol === 'medico';
        const crudos = listarCirugias().filter(c => c.estatus === 'programada' && c.sala === sala && fechaDeCirugia(c) === fecha).map(c => {
            const a = minutosInicioCirugia(c), b = minutosFinCirugia(c);
            if (a === null || b === null || b <= a) return null;
            const inicio = Math.max(a, QX_DIA_INICIO), fin = Math.min(b, QX_DIA_FIN);
            if (fin <= inicio) return null;
            const hi = horaDeMinutos(inicio), hf = horaDeMinutos(fin);
            const f = ocultar ? null : fichaCirugia(c);
            const etiqueta = ocultar
                ? 'Horario Ocupado (' + hi + ' - ' + hf + ')'
                : 'Ocupado: ' + hi + ' - ' + hf + (f ? ' · ' + f.nombre + ' · ' + f.procedimiento + ' · ' + f.medico_cirujano : '');
            return { tipo: 'ocupado', inicio: hi, fin: hf, inicio_min: inicio, fin_min: fin, etiqueta: etiqueta };
        }).filter(Boolean).sort((a, b) => a.inicio_min - b.inicio_min);
        const fusion = [];
        crudos.forEach(iv => {
            const ultimo = fusion[fusion.length - 1];
            if (!ultimo || iv.inicio_min > ultimo.fin_min) fusion.push({ inicio_min: iv.inicio_min, fin_min: iv.fin_min });
            else ultimo.fin_min = Math.max(ultimo.fin_min, iv.fin_min);
        });
        const ahora = new Date();
        const hoy = fecha === fechaLocalDeDate(ahora);
        const corte = hoy ? ahora.getHours() * 60 + ahora.getMinutes() : null;
        const piezas = [];
        let cursor = QX_DIA_INICIO;
        const empujarLibre = (desde, hasta) => {
            if (hasta <= desde) return;
            const partir = (a, b, tipo) => {
                if (b <= a) return;
                piezas.push({ tipo: tipo, inicio: horaDeMinutos(a), fin: horaDeMinutos(b), inicio_min: a, fin_min: b, etiqueta: tipo === 'libre' ? 'Libre: ' + horaDeMinutos(a) + ' - ' + horaDeMinutos(b) : 'Horario pasado' });
            };
            if (corte !== null && corte > desde && corte < hasta) {
                partir(desde, corte, 'pasado');
                partir(Math.max(corte, desde), hasta, 'libre');
            } else if (corte !== null && corte >= hasta) partir(desde, hasta, 'pasado');
            else partir(desde, hasta, 'libre');
        };
        const ancho = QX_DIA_FIN - QX_DIA_INICIO;
        const barra = [];
        const meter = (desde, hasta, tipo, etiqueta) => {
            if (hasta <= desde) return;
            barra.push({ tipo: tipo, inicio: horaDeMinutos(desde), fin: horaDeMinutos(hasta), inicio_min: desde, fin_min: hasta, etiqueta: etiqueta, porcentaje: Math.max(0.8, ((hasta - desde) / ancho) * 100) });
        };
        fusion.forEach(iv => {
            empujarLibre(cursor, iv.inicio_min);
            const et = ocultar
                ? 'Horario Ocupado (' + horaDeMinutos(iv.inicio_min) + ' - ' + horaDeMinutos(iv.fin_min) + ')'
                : crudos.filter(x => x.inicio_min < iv.fin_min && iv.inicio_min < x.fin_min).map(x => x.etiqueta).join(' · ');
            meter(iv.inicio_min, iv.fin_min, 'ocupado', et);
            cursor = Math.max(cursor, iv.fin_min);
        });
        empujarLibre(cursor, QX_DIA_FIN);
        piezas.forEach(p => meter(p.inicio_min, p.fin_min, p.tipo, p.etiqueta));
        barra.sort((a, b) => a.inicio_min - b.inicio_min || (a.tipo === 'ocupado' ? 1 : 0));
        const ocupadosVisibles = crudos.map(iv => ({ tipo: 'ocupado', inicio: iv.inicio, fin: iv.fin, inicio_min: iv.inicio_min, fin_min: iv.fin_min, etiqueta: iv.etiqueta }));
        return { ok: true, tramos: barra, ocupados: ocupadosVisibles, libres: piezas.filter(t => t.tipo === 'libre') };
    }
    function validarCirugia(entrada, ahora, s) {
        const letra = t => /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'.\- ]{2,}$/.test(t);
        const v = {
            nombres: limpiarEspacios(entrada.nombres), apellido_paterno: limpiarEspacios(entrada.apellido_paterno), apellido_materno: limpiarEspacios(entrada.apellido_materno),
            nombre: limpiarEspacios(entrada.nombre), fecha_nacimiento: entrada.fecha_nacimiento || '', paciente_id: entrada.paciente_id || '',
            sexo: entrada.sexo || '', telefono: String(entrada.telefono || '').replace(/\D/g, ''), direccion: limpiarEspacios(entrada.direccion),
            procedimiento: limpiarEspacios(entrada.procedimiento), tipo_estancia: entrada.tipo_estancia || '', sala: entrada.sala || '',
            fecha: entrada.fecha || '', hora_inicio: entrada.hora_inicio || '', duracion_minutos: Number(entrada.duracion_minutos),
            medico_cirujano_id: entrada.medico_cirujano_id || '', anestesiologo_id: entrada.anestesiologo_id || '',
            indicaciones_preoperatorias: String(entrada.indicaciones_preoperatorias || '').trim(), notas: String(entrada.notas || '').trim()
        };
        if (v.nombres || v.apellido_paterno || v.apellido_materno) v.nombre = limpiarEspacios([v.nombres, v.apellido_paterno, v.apellido_materno].filter(Boolean).join(' '));
        const errores = {};
        if (!v.paciente_id) {
            if (!letra(v.nombres)) errores.nombres = 'Escriba el nombre (solo letras).';
            if (!letra(v.apellido_paterno)) errores.paterno = 'Escriba el apellido paterno (solo letras).';
            if (v.apellido_materno && !letra(v.apellido_materno)) errores.materno = 'El apellido materno solo admite letras.';
            if (v.sexo !== 'F' && v.sexo !== 'M') errores.sexo = 'Seleccione el sexo.';
        }
        if (entrada.telefono !== undefined || entrada.direccion !== undefined) {
            if (v.telefono.length !== 10) errores.telefono = 'Escriba 10 dígitos de teléfono o celular.';
            if (v.direccion.length < 8 || v.direccion.length > 150) errores.direccion = 'Escriba calle, número y colonia (mínimo 8 caracteres).';
        }
        if (!errores.nombres && !errores.paterno && (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'.\- ]{5,}$/.test(v.nombre) || v.nombre.split(' ').filter(w => w.length > 1).length < 2)) errores.nombre = 'Escriba nombre y apellido (solo letras).';
        if (!parseFechaISO(v.fecha_nacimiento)) errores.fecha_nacimiento = 'Seleccione la fecha de nacimiento.';
        else if (v.fecha_nacimiento > hoyLocal() || v.fecha_nacimiento < '1900-01-01') errores.fecha_nacimiento = 'La fecha de nacimiento no es válida.';
        if (contarLetrasTxt(v.procedimiento) < 4) errores.procedimiento = 'Escriba el nombre de la cirugía.';
        if (v.tipo_estancia !== 'AMBULATORIA' && v.tipo_estancia !== 'HOSPITALARIA') errores.tipo_estancia = 'Seleccione si la cirugía es ambulatoria u hospitalaria.';
        if (!salaPorCodigo(v.sala)) errores.sala = 'Seleccione el quirófano.';
        const dur = duracionPorMinutos(v.duracion_minutos);
        if (!dur) errores.duracion_minutos = 'Seleccione la duración estimada.';
        const ini = minutosDeHora(v.hora_inicio);
        if (!parseFechaISO(v.fecha)) errores.fecha = 'Seleccione la fecha de la cirugía.';
        else if (v.fecha < hoyLocal()) errores.fecha = 'La fecha no puede ser anterior a hoy.';
        if (ini === null) errores.hora_inicio = 'Seleccione la hora de inicio.';
        else if (ini < QX_DIA_INICIO || ini >= QX_DIA_FIN) errores.hora_inicio = 'El quirófano opera de 07:00 a 22:00.';
        let fin = null;
        if (!errores.hora_inicio && dur) {
            fin = ini + dur.minutos;
            v.hora_fin = horaDeMinutos(fin);
            v.duracion_minutos = dur.minutos;
            if (fin > QX_DIA_FIN) errores.hora_inicio = 'Con esa duración la cirugía pasaría de las 22:00. Elija una hora más temprana o una duración menor.';
        }
        const marca = v.fecha && v.hora_inicio ? new Date(v.fecha + 'T' + v.hora_inicio) : null;
        const reloj = ahora ? new Date(ahora) : new Date();
        if (marca && !isNaN(marca.getTime()) && marca.getTime() < reloj.getTime()) errores.hora_inicio = errores.hora_inicio || 'La hora de inicio debe ser posterior al momento actual.';
        const m = USUARIOS[v.medico_cirujano_id];
        const an = v.anestesiologo_id ? USUARIOS[v.anestesiologo_id] : null;
        if (!m || m.rol !== 'medico' || m.activo === false || m.especialidad_codigo === 'ANESTESIOLOGIA') errores.medico_cirujano_id = 'Seleccione al médico cirujano.';
        if (v.anestesiologo_id && (!an || an.rol !== 'medico' || an.activo === false || an.especialidad_codigo !== 'ANESTESIOLOGIA')) errores.anestesiologo_id = 'Seleccione un anestesiólogo o déjelo pendiente.';
        else if (an && m && an.id === m.id) errores.anestesiologo_id = 'El anestesiólogo debe ser distinto del cirujano.';
        if (!errores.sala && !errores.fecha && fin !== null && !errores.hora_inicio) {
            const choque = listarCirugias().find(c => {
                if (c.estatus !== 'programada' || c.sala !== v.sala || fechaDeCirugia(c) !== v.fecha) return false;
                const a0 = minutosInicioCirugia(c), a1 = minutosFinCirugia(c);
                return a0 !== null && a1 !== null && a0 < fin && ini < a1;
            });
            if (choque) {
                const detalle = (!s || s.rol === 'medico') ? '' : ' (' + horaDeMinutos(minutosInicioCirugia(choque)) + ' - ' + horaDeMinutos(minutosFinCirugia(choque)) + ')';
                errores.hora_inicio = 'Ese horario se cruza con otra cirugía activa en la misma sala' + detalle + '.';
            }
        }
        if (v.indicaciones_preoperatorias.length > 600) errores.indicaciones_preoperatorias = 'Máximo 600 caracteres.';
        if (v.notas.length > 600) errores.notas = 'Máximo 600 caracteres.';
        return { ok: Object.keys(errores).length === 0, errores: errores, valores: v };
    }
    function programarCirugia(entrada, s) {
        if (!s || !permisoAccionDe(s.usuario_id, 'programar_cirugia')) return { ok: false, motivo: 'Su perfil no puede programar cirugías.' };
        const r = validarCirugia(entrada, null, s);
        if (!r.ok) return { ok: false, motivo: 'Revise los campos marcados.', errores: r.errores };
        const v = r.valores, m = USUARIOS[v.medico_cirujano_id], an = v.anestesiologo_id ? USUARIOS[v.anestesiologo_id] : null;
        let pac = (v.paciente_id && buscarPacientePorId(v.paciente_id)) || buscarPacientePorIdentidad(v.nombre, v.fecha_nacimiento);
        pac = guardarPaciente({
            paciente_id: pac ? pac.paciente_id : '',
            nombres: v.nombres, apellido_paterno: v.apellido_paterno, apellido_materno: v.apellido_materno,
            nombre_completo: pac ? pac.nombre_completo : v.nombre,
            fecha_nacimiento: v.fecha_nacimiento, sexo: v.sexo || (pac && pac.sexo) || '',
            telefono: v.telefono, direccion: v.direccion
        }) || pac;
        const inicio = new Date(v.fecha + 'T' + v.hora_inicio);
        const c = {
            cirugia_id: uid('CX'), paciente_id: pac ? pac.paciente_id : (v.paciente_id || null), paciente_nombre: pac ? pac.nombre_completo : v.nombre, fecha_nacimiento: v.fecha_nacimiento,
            procedimiento: v.procedimiento, tipo_estancia: v.tipo_estancia, sala: v.sala, fecha: v.fecha,
            hora_inicio: v.hora_inicio, hora_fin: v.hora_fin, duracion_minutos: v.duracion_minutos, fecha_hora: inicio.toISOString(),
            medico_cirujano_id: m.id, medico_cirujano_nombre: m.nombre,
            anestesiologo_id: an ? an.id : null, anestesiologo_nombre: an ? an.nombre : '',
            indicaciones_preoperatorias: v.indicaciones_preoperatorias, notas: v.notas,
            turno_id: null, ingresado_en: null,
            estatus: 'programada', programada_por_id: s.usuario_id, programada_por_nombre: s.nombre, creado_en: new Date().toISOString()
        };
        const lista = listarCirugias().concat([c]);
        return escribir(CLAVES.cirugias, lista) ? { ok: true, cirugia: fichaCirugia(c) } : { ok: false, motivo: 'No se pudo guardar (almacenamiento lleno o bloqueado).' };
    }
    function asignarAnestesiologo(cirugiaId, anestesiologoId, s) {
        if (!s || (s.rol !== 'admin' && s.rol !== 'administrador')) return { ok: false, motivo: 'Solo Administración puede asignar al anestesiólogo.' };
        const lista = listarCirugias();
        const c = lista.find(x => x.cirugia_id === cirugiaId);
        if (!c || c.estatus === 'cancelada') return { ok: false, motivo: 'No se encontró la cirugía.' };
        const an = USUARIOS[anestesiologoId];
        if (!an || an.rol !== 'medico' || an.activo === false || an.especialidad_codigo !== 'ANESTESIOLOGIA') return { ok: false, motivo: 'Seleccione un anestesiólogo activo.' };
        if (an.id === c.medico_cirujano_id) return { ok: false, motivo: 'El anestesiólogo debe ser distinto del cirujano.' };
        c.anestesiologo_id = an.id;
        c.anestesiologo_nombre = an.nombre;
        c.anestesiologo_asignado_en = new Date().toISOString();
        c.anestesiologo_asignado_por_id = s.usuario_id;
        c.anestesiologo_asignado_por_nombre = s.nombre;
        return escribir(CLAVES.cirugias, lista) ? { ok: true, cirugia: fichaCirugia(c) } : { ok: false, motivo: 'No se pudo guardar (almacenamiento lleno o bloqueado).' };
    }
    function ingresarPacienteAmbulatorio(cirugiaId, s) {
        if (!puedeIngresarAmbulatorio(s)) return { ok: false, motivo: 'Su perfil no puede ingresar pacientes ambulatorios a quirófano.' };
        const lista = listarCirugias();
        const c = lista.find(x => x.cirugia_id === cirugiaId);
        if (!c || c.estatus !== 'programada') return { ok: false, motivo: 'La cirugía no está programada.' };
        if (c.tipo_estancia !== 'AMBULATORIA') return { ok: false, motivo: 'Solo las cirugías ambulatorias entran directo a quirófano.' };
        if (c.ingresado_en || c.turno_id) return { ok: false, motivo: 'Este paciente ya fue ingresado a quirófano.' };
        let pac = c.paciente_id ? buscarPacientePorId(c.paciente_id) : buscarPacientePorIdentidad(c.paciente_nombre, c.fecha_nacimiento);
        if (!pac) pac = guardarPaciente({ nombre_completo: c.paciente_nombre, fecha_nacimiento: c.fecha_nacimiento });
        if (pacienteInternadoActivo(Object.assign({}, c, { paciente_id: pac.paciente_id, paciente_nombre: pac.nombre_completo }))) return { ok: false, motivo: 'Este paciente ya tiene un episodio hospitalario activo.' };
        const medico = USUARIOS[c.medico_cirujano_id];
        if (!medico || !medico.medico_id) return { ok: false, motivo: 'No se encontró al cirujano de esta programación.' };
        const esp = especialidadPorCodigo(medico.especialidad_codigo);
        const ahoraIso = new Date().toISOString();
        const turnos = listarTurnos();
        const turno = {
            turno_id: uid('T'), paciente_id: pac.paciente_id, paciente_nombre: pac.nombre_completo, fecha_nacimiento: pac.fecha_nacimiento, sexo: pac.sexo || null,
            especialidad_codigo: medico.especialidad_codigo, especialidad: esp ? esp.nombre : medico.cargo,
            medico_id: medico.medico_id, medico_nombre: medico.nombre, motivo: c.procedimiento, fecha_turno: hoyLocal(),
            numero_turno: siguienteNumeroTurno(medico.especialidad_codigo), timestamp_llegada: ahoraIso,
            estatus: ESTATUS.INTERNADO, modalidad: MODALIDAD_AMBULATORIO_QX, sin_nota_consulta: true,
            area_destino: AREA_AMBULATORIO_QX, destino: 'Quirofano', signos_vitales: null, cargos: [], cuenta_actual: 0, cuenta_actual_total: 0,
            cirugia_id: c.cirugia_id, registrado_por: s.usuario_id
        };
        turnos.push(turno);
        if (!escribir(CLAVES.turnos, turnos)) return { ok: false, motivo: 'No se pudo crear el episodio.' };
        const hoja = nuevaHojaIndicaciones([], 'preoperatorio', {
            dieta: 'Ayuno según indicación preoperatoria.', soluciones_parenterales: '', medicamentos: '',
            medidas_generales: c.indicaciones_preoperatorias || 'Sin indicaciones preoperatorias registradas.'
        }, { id: medico.id, nombre: medico.nombre, relacion: 'tratante' }, ahoraIso);
        const internamiento = {
            internamiento_id: uid('INT'), turno_id: turno.turno_id, paciente_id: pac.paciente_id,
            medico_tratante_id: medico.medico_id, medico_tratante_nombre: medico.nombre,
            especialidad_codigo: medico.especialidad_codigo, especialidad: turno.especialidad,
            fecha_ingreso: ahoraIso, cama: null, estatus: 'activo', modalidad: MODALIDAD_AMBULATORIO_QX, sin_nota_consulta: true,
            hoja_frontal_habilitada: true, consentimientos_habilitados: true,
            area_destino: AREA_AMBULATORIO_QX, destino: 'Quirofano',
            diagnostico_ingreso: c.procedimiento, diagnostico_actual: c.procedimiento, alergias: null,
            interconsultas: [], notas_evolucion: [], hojas_indicaciones: [hoja], cargos: [], cuenta_actual: 0, cuenta_actual_total: 0,
            nota_egreso: null, cirugia_id: c.cirugia_id,
            ubicacion: UBICACION_QX.EN_TRANSITO_QUIROFANO, cama_origen_piso: null,
            notas_postanestesicas: [], notas_postoperatorias: [], recetas_controlados: []
        };
        if (!guardarInternamiento(internamiento)) return { ok: false, motivo: 'No se pudo abrir el internamiento.' };
        c.paciente_id = pac.paciente_id;
        c.paciente_nombre = pac.nombre_completo;
        c.turno_id = turno.turno_id;
        c.internamiento_id = internamiento.internamiento_id;
        c.ingresado_en = ahoraIso;
        if (!escribir(CLAVES.cirugias, lista)) return { ok: false, motivo: 'El episodio se creó, pero no se pudo marcar la cirugía.' };
        return { ok: true, turno: turno, internamiento: internamiento, cirugia: fichaCirugia(c) };
    }

    function camaPorCodigo(codigo) { return resolverCama(codigo); }
    function camaPorNombre(nombre) { return resolverCama(nombre); }
    function camasDeArea(area) { return CAMAS_HOSPITAL.filter(c => c.area === area); }
    function ubicacionDe(i) {
        if (!i) return UBICACION_QX.PISO;
        if (i.ubicacion) return i.ubicacion;
        if (i.modalidad === MODALIDAD_AMBULATORIO_QX) return i.cama && camaPorNombre(i.cama) && camaPorNombre(i.cama).area === 'QUIROFANO' ? UBICACION_QX.QUIROFANO : UBICACION_QX.EN_TRANSITO_QUIROFANO;
        return UBICACION_QX.PISO;
    }
    function camaEstaOcupada(cama, exceptoId) {
        if (!cama) return null;
        return listarInternamientos().find(x => {
            if (x.internamiento_id === exceptoId || x.estatus !== 'activo') return false;
            const est = (obtenerTurno(x.turno_id) || {}).estatus;
            if (est !== 'internado' && est !== 'internado_en_proceso') return false;
            if (x.cama_codigo === cama.codigo) return true;
            const texto = normalizar(x.cama || '');
            if (!texto) return false;
            if (texto === normalizar(cama.nombre) || texto === normalizar(cama.codigo)) return true;
            if (ALIAS_NOMBRE_CAMA[texto] === cama.codigo) return true;
            const area = codigoAreaEstancia(x, obtenerTurno(x.turno_id));
            if (area !== cama.area) return false;
            const num = normalizar(cama.numero);
            return texto === num || texto === normalizar('cama ' + cama.numero);
        }) || null;
    }
    function camaOcupadaPor(nombre, exceptoId) {
        const cama = resolverCama(nombre);
        if (cama) return camaEstaOcupada(cama, exceptoId);
        const clave = normalizar(nombre);
        if (!clave) return null;
        return listarInternamientos().find(x => x.internamiento_id !== exceptoId && x.estatus === 'activo' && normalizar(x.cama) === clave
            && ['internado', 'internado_en_proceso'].includes((obtenerTurno(x.turno_id) || {}).estatus)) || null;
    }
    function camasLibres(area, exceptoId) {
        return camasDeArea(area).filter(c => !camaOcupadaPor(c.nombre, exceptoId)).map(c => ({ codigo: c.codigo, nombre: c.nombre, area: c.area }));
    }
    function cirugiaRawDePaciente(turno, ahora) {
        if (!turno) return null;
        const t0 = (ahora ? new Date(ahora) : new Date()).getTime();
        const lista = listarCirugias().filter(c => c.estatus === 'programada' && mismoPacienteCirugia(c, turno))
            .sort((a, b) => Date.parse(a.fecha_hora) - Date.parse(b.fecha_hora));
        return lista.find(c => finEpochCirugia(c) >= t0) || lista[lista.length - 1] || null;
    }
    function minutosParaInicioCirugia(c, ahora) {
        if (!c) return null;
        const t0 = (ahora ? new Date(ahora) : new Date()).getTime();
        return Math.round((Date.parse(c.fecha_hora) - t0) / 60000);
    }
    function enCirugiaDeProgramacion(c, ahora) {
        if (!c) return false;
        const turno = (c.turno_id && obtenerTurno(c.turno_id)) || listarTurnos().find(t => t.estatus === ESTATUS.INTERNADO && mismoPacienteCirugia(c, t));
        const i = turno ? internamientoDeTurno(turno.turno_id) : null;
        if (!i || ubicacionDe(i) !== UBICACION_QX.QUIROFANO) return false;
        const t0 = (ahora ? new Date(ahora) : new Date()).getTime();
        return t0 >= Date.parse(c.fecha_hora) && t0 < finEpochCirugia(c);
    }
    function puedePasarAQuirofano(s) { return !!s && (s.rol === 'enf_hospital' || s.rol === 'admin' || s.rol === 'administrador'); }
    function puedeAdelantarTraslado(s) { return !!s && (s.rol === 'admin' || s.rol === 'administrador'); }
    function puedeRecibirQuirofano(s) { return !!s && (s.rol === 'enf_quirofano' || s.rol === 'admin' || s.rol === 'administrador'); }
    function puedeRegresarAPiso(s) { return !!s && (s.rol === 'enf_quirofano' || s.rol === 'enf_hospital' || s.rol === 'admin' || s.rol === 'administrador'); }
    function cirugiaDeInternamiento(i) {
        if (!i) return null;
        const porId = i.cirugia_id ? listarCirugias().find(c => c.cirugia_id === i.cirugia_id && c.estatus !== 'cancelada') : null;
        return porId || cirugiaRawDePaciente(obtenerTurno(i.turno_id));
    }
    function esCirujanoDelInternamiento(i, s) {
        if (!s || s.rol !== 'medico') return false;
        const t = obtenerTurno(i.turno_id);
        if (relacionMedico(i, t, s) === 'tratante') return true;
        const c = cirugiaDeInternamiento(i);
        return !!(c && (c.medico_cirujano_id === s.medico_id || c.medico_cirujano_id === s.usuario_id));
    }
    function esAnestesiologoDelInternamiento(i, s) {
        if (!s || s.rol !== 'medico' || s.especialidad_codigo !== 'ANESTESIOLOGIA') return false;
        const c = cirugiaDeInternamiento(i);
        return !!(c && (c.anestesiologo_id === s.medico_id || c.anestesiologo_id === s.usuario_id));
    }
    function puedeNotaPostanestesica(s, i) {
        return !!s && !!i && (s.rol === 'admin' || esAnestesiologoDelInternamiento(i, s) || esCirujanoDelInternamiento(i, s));
    }
    function puedeNotaPostoperatoria(s, i) {
        return !!s && !!i && (s.rol === 'admin' || esCirujanoDelInternamiento(i, s));
    }
    function puedeImprimirHojaTrans(s) {
        return !!s && (s.rol === 'admin' || s.rol === 'enf_quirofano' || (s.rol === 'medico' && s.especialidad_codigo === 'ANESTESIOLOGIA'));
    }
    function puedeAltaAmbulatoria(s, i) {
        if (!s || !i || i.modalidad !== MODALIDAD_AMBULATORIO_QX) return false;
        const t = obtenerTurno(i.turno_id);
        if (!t || t.estatus !== ESTATUS.INTERNADO || !(i.notas_postoperatorias || []).length) return false;
        return s.rol === 'admin' || esCirujanoDelInternamiento(i, s);
    }
    function puedeConvertirAPiso(s, i) {
        if (!s || !i || i.modalidad !== MODALIDAD_AMBULATORIO_QX) return false;
        const t = obtenerTurno(i.turno_id);
        if (!t || t.estatus !== ESTATUS.INTERNADO) return false;
        return s.rol === 'admin' || s.rol === 'administrador' || s.rol === 'enf_quirofano' || s.rol === 'enf_hospital' || esCirujanoDelInternamiento(i, s);
    }
    function flujoQuirofanoDe(turno, i, s, ahora) {
        const c = cirugiaRawDePaciente(turno, ahora);
        const ficha = c ? fichaCirugia(c) : null;
        const ubicacion = ubicacionDe(i);
        const minutos = c ? minutosParaInicioCirugia(c, ahora) : null;
        const enPiso = ubicacion === UBICACION_QX.PISO;
        const ambulatorio = ((i && i.modalidad) || (turno && turno.modalidad)) === MODALIDAD_AMBULATORIO_QX;
        const cuando = ficha ? ((ficha.fecha_texto || '') + ' ' + (ficha.hora_texto || '')).trim() : '';
        const aviso = ficha ? ('Cirugía Programada: ' + ficha.procedimiento + ' — ' + cuando + ' (' + (ficha.sala_nombre || 'Sala') + ') — Cirujano: ' + (ficha.medico_cirujano || 'Sin cirujano')) : '';
        return {
            cirugia_id: c ? c.cirugia_id : null,
            procedimiento: ficha ? ficha.procedimiento : '',
            cuando: cuando,
            sala_nombre: ficha ? ficha.sala_nombre : '',
            cirujano: ficha ? ficha.medico_cirujano : '',
            aviso: aviso,
            minutos_para_inicio: minutos,
            traslado_habilitado: !!(c && minutos !== null && minutos <= QX_TRASLADO_MINUTOS),
            ubicacion: ubicacion,
            cama_origen_piso: (i && i.cama_origen_piso) || '',
            en_transito: ubicacion === UBICACION_QX.EN_TRANSITO_QUIROFANO,
            en_quirofano: ubicacion === UBICACION_QX.QUIROFANO,
            en_cirugia: enCirugiaDeProgramacion(c, ahora),
            puede_pasar: !!(s && puedePasarAQuirofano(s) && c && enPiso && !ambulatorio && turno && turno.estatus === ESTATUS.INTERNADO),
            puede_adelantar: !!(s && puedeAdelantarTraslado(s) && c && enPiso && !ambulatorio),
            puede_recibir: !!(s && puedeRecibirQuirofano(s) && (ubicacion === UBICACION_QX.EN_TRANSITO_QUIROFANO)),
            tiene_postoperatoria: !!((i && i.notas_postoperatorias) || []).length,
            puede_regresar: !!(s && i && puedeRegresarAPiso(s) && (i.notas_postoperatorias || []).length && !ambulatorio && ubicacion === UBICACION_QX.QUIROFANO),
            puede_alta_ambulatoria: puedeAltaAmbulatoria(s, i),
            puede_convertir: puedeConvertirAPiso(s, i)
        };
    }
    function pasarPacienteAQuirofano(turnoId, s, opciones) {
        opciones = opciones || {};
        if (!puedePasarAQuirofano(s)) return { ok: false, motivo: 'Su perfil no puede pasar pacientes a quirófano.' };
        const t = obtenerTurno(turnoId);
        const i = t && asegurarInternamiento(turnoId);
        if (!t || !i || t.estatus !== ESTATUS.INTERNADO) return { ok: false, motivo: 'El paciente no está hospitalizado.' };
        if (i.modalidad === MODALIDAD_AMBULATORIO_QX) return { ok: false, motivo: 'El paciente ambulatorio ya entra directo a quirófano.' };
        if (ubicacionDe(i) !== UBICACION_QX.PISO) return { ok: false, motivo: 'Este paciente ya salió de su cama de piso.' };
        const c = cirugiaRawDePaciente(t);
        if (!c) return { ok: false, motivo: 'Este paciente no tiene una cirugía programada.' };
        const minutos = minutosParaInicioCirugia(c);
        if (minutos > QX_TRASLADO_MINUTOS && !opciones.adelantar) return { ok: false, motivo: 'El traslado se habilita cuando faltan 40 minutos o menos. Faltan ' + minutos + ' min.' };
        if (opciones.adelantar && !puedeAdelantarTraslado(s)) return { ok: false, motivo: 'Solo Administración puede adelantar el traslado.' };
        i.cama_origen_piso = i.cama_codigo || i.cama || i.cama_origen_piso || null;
        i.cama = null;
        i.cama_codigo = null;
        i.ubicacion = UBICACION_QX.EN_TRANSITO_QUIROFANO;
        i.area_destino = 'Quirófano';
        i.cirugia_id = c.cirugia_id;
        i.traslado_qx_en = new Date().toISOString();
        i.traslado_adelantado = !!opciones.adelantar;
        if (!guardarInternamiento(i)) return { ok: false, motivo: 'No se pudo guardar el traslado.' };
        actualizarTurno(t.turno_id, { area_destino: 'Quirófano', destino: 'Quirofano' });
        return { ok: true, internamiento: obtenerInternamiento(i.internamiento_id), cirugia: fichaCirugia(c) };
    }
    function recibirEnQuirofano(turnoId, camaCodigo, s) {
        if (!puedeRecibirQuirofano(s)) return { ok: false, motivo: 'Su perfil no puede recibir pacientes en quirófano.' };
        const i = asegurarInternamiento(turnoId);
        const t = obtenerTurno(turnoId);
        if (!i || !t || t.estatus !== ESTATUS.INTERNADO) return { ok: false, motivo: 'El paciente no está en un episodio activo.' };
        if (ubicacionDe(i) !== UBICACION_QX.EN_TRANSITO_QUIROFANO) return { ok: false, motivo: 'Este paciente no está en tránsito a quirófano.' };
        const cama = camaPorCodigo(camaCodigo) || camaPorNombre(camaCodigo);
        if (!cama || cama.area !== 'QUIROFANO') return { ok: false, motivo: 'Seleccione una cama de recuperación.' };
        const ocupada = camaOcupadaPor(cama.nombre, i.internamiento_id);
        if (ocupada) { const o = obtenerTurno(ocupada.turno_id); return { ok: false, motivo: cama.nombre + ' ya está ocupada' + (o ? ' por ' + o.paciente_nombre : '') + '.' }; }
        i.cama = cama.nombre;
        i.cama_codigo = cama.codigo;
        i.area_codigo = 'QUIROFANO';
        i.ubicacion = UBICACION_QX.QUIROFANO;
        i.area_destino = 'Quirófano / Recuperación';
        i.recibido_qx_en = new Date().toISOString();
        if (!guardarInternamiento(i)) return { ok: false, motivo: 'No se pudo asignar la cama de recuperación.' };
        actualizarTurno(t.turno_id, { area_destino: i.area_destino, destino: 'Quirofano' });
        return { ok: true, internamiento: obtenerInternamiento(i.internamiento_id) };
    }
    function regresarAHospitalizacion(turnoId, camaCodigo, s) {
        if (!puedeRegresarAPiso(s)) return { ok: false, motivo: 'Su perfil no puede regresar pacientes a hospitalización.' };
        const i = asegurarInternamiento(turnoId);
        const t = obtenerTurno(turnoId);
        if (!i || !t || t.estatus !== ESTATUS.INTERNADO) return { ok: false, motivo: 'El paciente no está hospitalizado.' };
        if (!(i.notas_postoperatorias || []).length) return { ok: false, motivo: 'Falta la nota post-operatoria para salir de recuperación.' };
        if (i.modalidad === MODALIDAD_AMBULATORIO_QX) return { ok: false, motivo: 'El paciente ambulatorio no regresa a una cama de piso.' };
        if (ubicacionDe(i) !== UBICACION_QX.QUIROFANO) return { ok: false, motivo: 'El paciente no está en recuperación.' };
        let nombreDestino = camaCodigo || i.cama_origen_piso || '';
        let destino = camaPorCodigo(nombreDestino) || camaPorNombre(nombreDestino);
        if (destino && destino.area !== 'HOSPITALIZACION' && destino.area !== 'OBSERVACION') return { ok: false, motivo: 'Seleccione una cama de piso.' };
        if (!destino && nombreDestino && !camaCodigo) destino = { nombre: nombreDestino, area: 'HOSPITALIZACION' };
        if (!destino) return { ok: false, motivo: 'Seleccione una cama de piso.' };
        const ocupada = camaOcupadaPor(destino.nombre, i.internamiento_id);
        if (ocupada) return { ok: false, motivo: destino.nombre + ' está ocupada. Elija otra cama de piso.', ocupada: true };
        i.cama = destino.nombre;
        i.cama_codigo = destino.codigo || null;
        i.area_codigo = destino.area === 'OBSERVACION' ? 'OBSERVACION' : 'HOSPITALIZACION';
        i.ubicacion = UBICACION_QX.PISO;
        i.area_destino = destino.area === 'OBSERVACION' ? 'Observación' : 'Hospitalización';
        i.regreso_piso_en = new Date().toISOString();
        if (!guardarInternamiento(i)) return { ok: false, motivo: 'No se pudo registrar el regreso.' };
        actualizarTurno(t.turno_id, { area_destino: i.area_destino, destino: 'Hospitalizacion' });
        return { ok: true, internamiento: obtenerInternamiento(i.internamiento_id) };
    }
    function datosHojaTransanestesica(turnoId) {
        const t = obtenerTurno(turnoId);
        const i = t && internamientoDeTurno(turnoId);
        if (!t || !i) return null;
        const p = buscarPacientePorId(t.paciente_id) || {};
        const c = cirugiaDeInternamiento(i);
        const ficha = c ? fichaCirugia(c) : null;
        const fuentes = [];
        if (t.signos_vitales) fuentes.push(t.signos_vitales);
        ((i.notas_evolucion) || []).forEach(n => { if (n.objetivo && n.objetivo.signos_vitales) fuentes.push(n.objetivo.signos_vitales); });
        let peso = null, talla = null;
        fuentes.forEach(sv => { if (sv && sv.peso_kg != null) peso = sv.peso_kg; if (sv && sv.talla_m != null) talla = sv.talla_m; });
        const imc = peso && talla ? Math.round((peso / (talla * talla)) * 10) / 10 : null;
        const snap = i.snapshot_formulario || {};
        const grupo = (((snap.antecedentes || {}).no_patologicos || {}).grupo_rh || {}).valor || i.grupo_rh || 'No registrado';
        return {
            nombre: p.nombre_completo || t.paciente_nombre, nacimiento: fechaLegibleISO(p.fecha_nacimiento || t.fecha_nacimiento),
            edad: calcularEdad(p.fecha_nacimiento || t.fecha_nacimiento), sexo: p.sexo === 'F' ? 'Femenino' : (p.sexo === 'M' ? 'Masculino' : 'No registrado'),
            peso: peso, talla: talla, imc: imc, alergias: i.alergias || 'Ninguna referida', grupo_rh: grupo,
            diagnostico: i.diagnostico_actual || i.diagnostico_ingreso || (ficha && ficha.procedimiento) || '',
            cirugia: ficha ? ficha.procedimiento : (i.diagnostico_ingreso || ''),
            cirujano: ficha ? ficha.medico_cirujano : (i.medico_tratante_nombre || ''),
            anestesiologo: ficha && ficha.anestesiologo ? ficha.anestesiologo : 'Pendiente',
            sala: ficha ? ficha.sala_nombre : '', cuando: ficha ? ficha.hora_texto : ''
        };
    }
    function guardarNotaPostanestesica(turnoId, entrada, s) {
        const i = asegurarInternamiento(turnoId);
        const t = obtenerTurno(turnoId);
        if (!i || !t || t.estatus !== ESTATUS.INTERNADO) return { ok: false, motivo: 'El internamiento no está activo.' };
        if (!puedeNotaPostanestesica(s, i)) return { ok: false, motivo: 'Solo el anestesiólogo, el cirujano o Dirección pueden registrar la nota post-anestésica.' };
        const tecnica = TECNICAS_ANESTESIA.find(x => x.codigo === entrada.tecnica);
        const errores = {};
        if (!tecnica) errores.tecnica = 'Seleccione la técnica anestésica.';
        const aldrete = parseInt(entrada.aldrete, 10);
        if (!Number.isInteger(aldrete) || aldrete < 0 || aldrete > 10) errores.aldrete = 'Aldrete va de 0 a 10.';
        const sangrado = limpiarEspacios(entrada.sangrado);
        const incidentes = String(entrada.incidentes || '').trim();
        const evolucion = String(entrada.evolucion || '').trim();
        if (contarLetrasTxt(evolucion) < 10) errores.evolucion = 'Escriba la evolución post-anestésica (mínimo 10 letras).';
        const pendFI = ampulasFraccionIPendientes(turnoId);
        const justFI = Array.isArray(entrada.fraccion_i) ? entrada.fraccion_i : [];
        const faltanFI = pendFI.filter(u => { const j = justFI.find(x => x.uso_id === u.uso_id); return !j || !limpiarEspacios(j.lote) || !limpiarEspacios(j.dosis_administrada) || j.merma == null || String(j.merma).trim() === ''; });
        if (faltanFI.length) errores.fraccion_i = 'Justifique ' + faltanFI.length + ' ámpula(s) de Fracción I (Fentanilo/Midazolam): lote, dosis administrada y merma/desecho.';
        const meds = Array.isArray(entrada.medicamentos) ? entrada.medicamentos : [];
        const usos = [];
        meds.forEach(m => {
            const cat = MEDS_ANESTESIA.find(x => x.sku === m.sku);
            const cant = parseInt(m.cantidad, 10);
            if (!cat || !Number.isInteger(cant) || cant < 1 || cant > 5) errores.medicamentos = 'Revise los medicamentos y las cantidades (1 a 5).';
            else usos.push({ sku: cat.sku, nombre: cat.nombre, fraccion: cat.fraccion, cantidad: cant, caja_id: limpiarEspacios(m.caja_id), aplicador_id: m.aplicador_id || s.usuario_id });
        });
        if (Object.keys(errores).length) return { ok: false, motivo: 'Revise los campos marcados.', errores: errores };
        const resumen = tecnica.etiqueta + '. Aldrete ' + aldrete + '. ' + evolucion;
        const recetas = [];
        usos.filter(u => u.fraccion === 'I').forEach(u => {
            const caja = u.caja_id ? listarCajas().find(c => c.caja_id === u.caja_id && normalizar(c.sku) === normalizar(u.sku)) : null;
            if (!caja) errores.medicamentos = 'Seleccione la caja abierta de ' + u.nombre + ' (Caja, lote, receta especial y ámpulas restantes).';
            else if (restantesCaja(caja) < u.cantidad) errores.medicamentos = 'La caja ' + caja.folio_receta_especial + ' no tiene ámpulas suficientes de ' + u.nombre + '.';
        });
        if (errores.medicamentos) return { ok: false, motivo: errores.medicamentos, errores: errores };
        for (let k = 0; k < usos.length; k++) {
            const u = usos[k];
            if (u.fraccion !== 'I') continue;
            const r = dispensarAmpulas({ caja_id: u.caja_id, cantidad: u.cantidad, turno_id: t.turno_id, aplicador_id: u.aplicador_id || s.usuario_id, datos: resumen }, s);
            if (!r.ok) return { ok: false, motivo: r.motivo };
            (r.usos || [r.uso]).forEach(uso => {
                recetas.push({
                    receta_id: uso.uso_id, sku: u.sku, nombre: r.caja.nombre, cantidad: 1, fraccion: 'I',
                    numero: uso.numero, de: uso.de, lote: uso.lote, folio_receta_especial: uso.folio_receta_especial,
                    fecha_hora: uso.fecha_hora
                });
            });
        }
        const nota = {
            nota_id: uid('PA'), folio: 'PA-' + pad3((i.notas_postanestesicas || []).length + 1), fecha_hora: new Date().toISOString(),
            autor_id: s.usuario_id, autor_nombre: s.nombre, tecnica: tecnica.codigo, tecnica_texto: tecnica.etiqueta,
            aldrete: aldrete, sangrado: sangrado, incidentes: incidentes, evolucion: evolucion,
            medicamentos: usos, recetas: recetas
        };
        const vigente = obtenerInternamiento(i.internamiento_id);
        vigente.notas_postanestesicas = (vigente.notas_postanestesicas || []).concat([nota]);
        vigente.recetas_controlados = (vigente.recetas_controlados || []).concat(recetas);
        nota.fraccion_i_justificada = justFI;
        if (!guardarInternamiento(vigente)) return { ok: false, motivo: 'No se pudo guardar la nota.' };
        if (justFI.length) justificarAmpulasFraccionI(turnoId, justFI, s);
        return { ok: true, nota: nota, recetas: recetas, internamiento: obtenerInternamiento(i.internamiento_id) };
    }
    function guardarNotaPostoperatoria(turnoId, entrada, s) {
        const i = asegurarInternamiento(turnoId);
        const t = obtenerTurno(turnoId);
        if (!i || !t || t.estatus !== ESTATUS.INTERNADO) return { ok: false, motivo: 'El internamiento no está activo.' };
        if (!puedeNotaPostoperatoria(s, i)) return { ok: false, motivo: 'Solo el cirujano o Dirección pueden registrar la nota post-operatoria.' };
        const v = {
            dx_pre: limpiarEspacios(entrada.dx_pre), dx_post: limpiarEspacios(entrada.dx_post),
            operacion: limpiarEspacios(entrada.operacion), tecnica: String(entrada.tecnica || '').trim(),
            hallazgos: String(entrada.hallazgos || '').trim(), pronostico: limpiarEspacios(entrada.pronostico),
            sangrado_ml: parseInt(entrada.sangrado_ml, 10), patologia: entrada.patologia === 'si' || entrada.patologia === true ? 'si' : (entrada.patologia === 'no' ? 'no' : ''),
            entrada: !!entrada.entrada, pausa: !!entrada.pausa, salida: !!entrada.salida, conteo: !!entrada.conteo,
            indicaciones: String(entrada.indicaciones || '').trim()
        };
        const errores = {};
        if (!v.entrada || !v.pausa || !v.salida || !v.conteo) errores.segura = 'Marque entrada, pausa, salida y el conteo completo.';
        if (contarLetrasTxt(v.dx_pre) < 3) errores.dx_pre = 'Escriba el diagnóstico preoperatorio.';
        if (contarLetrasTxt(v.dx_post) < 3) errores.dx_post = 'Escriba el diagnóstico postoperatorio.';
        if (contarLetrasTxt(v.operacion) < 3) errores.operacion = 'Escriba la operación realizada.';
        if (contarLetrasTxt(v.tecnica) < 10) errores.tecnica = 'Describa la técnica quirúrgica.';
        if (contarLetrasTxt(v.hallazgos) < 5) errores.hallazgos = 'Describa los hallazgos.';
        if (!Number.isInteger(v.sangrado_ml) || v.sangrado_ml < 0 || v.sangrado_ml > 20000) errores.sangrado_ml = 'Indique el sangrado en mililitros.';
        if (v.patologia !== 'si' && v.patologia !== 'no') errores.patologia = 'Indique si se envió pieza a patología.';
        if (contarLetrasTxt(v.pronostico) < 3) errores.pronostico = 'Escriba el pronóstico.';
        const cargarBiopsia = v.patologia === 'si' && entrada.cargar_biopsia !== false && entrada.cargar_biopsia !== 'false' && entrada.cargar_biopsia !== '0';
        const estudioBx = cargarBiopsia ? (estudioPorId(entrada.estudio_biopsia_id) || estudioPorCodigo(entrada.estudio_biopsia_id)) : null;
        if (cargarBiopsia && (!estudioBx || (estudioBx.categoria !== 'PATOLOGIA' && estudioBx.categoria !== 'LABORATORIO'))) errores.estudio_biopsia = 'Seleccione el estudio de biopsia del catálogo.';
        if (Object.keys(errores).length) return { ok: false, motivo: 'Revise los campos marcados.', errores: errores };
        const nota = {
            nota_id: uid('PO'), folio: 'PO-' + pad3((i.notas_postoperatorias || []).length + 1), fecha_hora: new Date().toISOString(),
            autor_id: s.usuario_id, autor_nombre: s.nombre,
            cirugia_segura: { entrada: true, pausa: true, salida: true, conteo: true },
            dx_pre: v.dx_pre, dx_post: v.dx_post, operacion: v.operacion, tecnica: v.tecnica, hallazgos: v.hallazgos,
            sangrado_ml: v.sangrado_ml, patologia: v.patologia, pronostico: v.pronostico,
            servicio: limpiarEspacios(entrada.servicio),
            fecha_programacion: limpiarEspacios(entrada.fecha_programacion),
            fecha_hora_quirurgica: limpiarEspacios(entrada.fecha_hora_quirurgica),
            recuento: String(entrada.recuento || '').trim(),
            uresis: limpiarEspacios(entrada.uresis),
            tipo_anestesia: limpiarEspacios(entrada.tipo_anestesia),
            firmantes: {
                cirujano: limpiarEspacios(entrada.cirujano),
                ayudante: limpiarEspacios(entrada.ayudante),
                anestesiologo: limpiarEspacios(entrada.anestesiologo),
                instrumentista: limpiarEspacios(entrada.instrumentista),
                circulante: limpiarEspacios(entrada.circulante),
                otro: limpiarEspacios(entrada.otro)
            },
            estudio_biopsia_id: estudioBx ? estudioBx.estudio_id : null,
            estudio_biopsia_nombre: estudioBx ? estudioBx.nombre : null
        };
        if (estudioBx) {
            const cargo = cargoDesdeEstudio(estudioBx, 1, { id: s.usuario_id, nombre: s.nombre }, { observaciones: 'Pieza enviada a patología · ' + nota.folio });
            const cobro = anexarCargosEstudios(t, [cargo]);
            if (!cobro) return { ok: false, motivo: 'No se pudo cargar el estudio de biopsia a la cuenta.' };
        }
        const vigentePo = obtenerInternamiento(i.internamiento_id) || i;
        vigentePo.notas_postoperatorias = (vigentePo.notas_postoperatorias || []).concat([nota]);
        vigentePo.diagnostico_actual = v.dx_post;
        let hoja = null;
        if (v.indicaciones) {
            const vig = indicacionesVigentes(vigentePo) || {};
            const textoHoja = k => { const x = vig[k]; return typeof x === 'string' ? x : ((x && x.texto) || ''); };
            hoja = nuevaHojaIndicaciones(vigentePo.hojas_indicaciones || [], 'postquirurgica', {
                dieta: textoHoja('dieta'), soluciones_parenterales: textoHoja('soluciones_parenterales'), medicamentos: textoHoja('medicamentos'),
                medidas_generales: v.indicaciones
            }, { id: s.usuario_id, nombre: s.nombre, relacion: 'tratante' });
            vigentePo.hojas_indicaciones = (vigentePo.hojas_indicaciones || []).concat([hoja]);
        }
        if (!guardarInternamiento(vigentePo)) return { ok: false, motivo: 'No se pudo guardar la nota.' };
        if (hoja) encolarSurtidoIndicacion(obtenerInternamiento(vigentePo.internamiento_id), hoja, indicacionesVigentes(vigentePo));
        return { ok: true, nota: nota, internamiento: obtenerInternamiento(i.internamiento_id) };
    }
    function altaAmbulatoriaQx(turnoId, s) {
        const i = asegurarInternamiento(turnoId);
        const t = obtenerTurno(turnoId);
        if (!puedeAltaAmbulatoria(s, i)) return { ok: false, motivo: 'El cirujano puede dar el alta ambulatoria cuando ya existe la nota post-operatoria.' };
        if (i.nota_egreso) return { ok: false, motivo: 'Ya existe una nota de egreso.' };
        const post = i.notas_postoperatorias[i.notas_postoperatorias.length - 1];
        const nota = {
            nota_id: uid('EG'), folio: 'EG-001', tipo: 'nota_egreso', fecha_hora: new Date().toISOString(),
            autor_id: s.usuario_id, autor_nombre: s.nombre, autor_especialidad: s.especialidad || null, relacion: 'tratante',
            motivo_egreso: 'Alta ambulatoria desde recuperación de quirófano.',
            resumen_clinico: post.tecnica + ' Hallazgos: ' + post.hallazgos,
            diagnostico_final: post.dx_post, pronostico: post.pronostico,
            plan_alta: 'Egreso el mismo día, sin cama de piso. ' + (post.operacion || ''),
            copias: 2, origen: 'alta_ambulatoria_qx'
        };
        i.nota_egreso = nota;
        i.diagnostico_actual = post.dx_post;
        i.estatus = ESTATUS.ALTA_PENDIENTE_PAGO;
        i.egreso_en = nota.fecha_hora;
        i.cama = null;
        i.cama_codigo = null;
        i.ubicacion = UBICACION_QX.PISO;
        if (!guardarInternamiento(i)) return { ok: false, motivo: 'No se pudo guardar el alta.' };
        actualizarTurno(t.turno_id, { estatus: ESTATUS.ALTA_PENDIENTE_PAGO, dx_principal: post.dx_post, cuenta_actual: i.cuenta_actual || 0, cuenta_actual_total: i.cuenta_actual || 0 });
        return { ok: true, nota: nota, internamiento: obtenerInternamiento(i.internamiento_id) };
    }
    function convertirAmbulatorioAPiso(turnoId, camaCodigo, s) {
        const i = asegurarInternamiento(turnoId);
        const t = obtenerTurno(turnoId);
        if (!puedeConvertirAPiso(s, i)) return { ok: false, motivo: 'Su perfil no puede convertir este ambulatorio a piso.' };
        const cama = camaPorCodigo(camaCodigo) || camaPorNombre(camaCodigo);
        if (!cama || cama.area !== 'HOSPITALIZACION') return { ok: false, motivo: 'Seleccione una cama de piso (Cama 1 a 4 o Aislado).' };
        const ocupada = camaOcupadaPor(cama.nombre, i.internamiento_id);
        if (ocupada) return { ok: false, motivo: cama.nombre + ' está ocupada.' };
        i.modalidad = 'HOSPITALIZACION';
        i.cama = cama.nombre;
        i.cama_codigo = cama.codigo;
        i.area_codigo = 'HOSPITALIZACION';
        i.cama_origen_piso = cama.codigo;
        i.ubicacion = UBICACION_QX.PISO;
        i.area_destino = 'Hospitalización';
        i.convertido_a_piso_en = new Date().toISOString();
        if (!guardarInternamiento(i)) return { ok: false, motivo: 'No se pudo convertir el internamiento.' };
        actualizarTurno(t.turno_id, { modalidad: 'HOSPITALIZACION', area_destino: 'Hospitalización', destino: 'Hospitalizacion' });
        return { ok: true, internamiento: obtenerInternamiento(i.internamiento_id) };
    }
    function citaQuirurgica(dias, h, min, duracion) {
        const base = new Date();
        const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + dias, h, min, 0, 0);
        return {
            fecha_hora: d.toISOString(), fecha: fechaLocalDeDate(d),
            hora_inicio: String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0'),
            hora_fin: horaDeMinutos(h * 60 + min + duracion), duracion_minutos: duracion
        };
    }
    // Datos de demostración dentro de la jornada 07:00–22:00, en las dos salas.
    function sembrarCirugiasSiHaceFalta() {
        if (localStorage.getItem(CLAVES.cirugias) !== null) return false;
        const enCatalogo = id => !!buscarPacientePorId(id);
        const ana = USUARIOS.dra_elena;
        const conAna = ana ? { anestesiologo_id: ana.id, anestesiologo_nombre: ana.nombre } : { anestesiologo_id: null, anestesiologo_nombre: '' };
        const lista = [
            Object.assign({ paciente_id: enCatalogo('PAC-000001') ? 'PAC-000001' : null, paciente_nombre: 'Carlos Ruiz Herrera', fecha_nacimiento: '1979-03-14', procedimiento: 'Colecistectomía laparoscópica', medico_cirujano_id: 'dr_arturo', sala: 'QX_GRANDE', tipo_estancia: 'HOSPITALARIA', indicaciones_preoperatorias: 'Ayuno de 8 horas. Tricotomía. Laboratorios previos.', notas: 'Alergia a penicilina: avisar al anestesiólogo.' }, citaQuirurgica(1, 7, 0, 90), conAna),
            Object.assign({ paciente_id: null, paciente_nombre: 'María Fernández Lozano', fecha_nacimiento: '1984-02-09', procedimiento: 'Safenectomía de miembro inferior derecho', medico_cirujano_id: 'dr_roberto', sala: 'QX_CHICO', tipo_estancia: 'AMBULATORIA', indicaciones_preoperatorias: 'Ayuno de 8 horas. Ingreso y egreso el mismo día, sin cama de piso.', notas: 'Prefiere anestesia regional.' }, citaQuirurgica(1, 9, 0, 60), conAna),
            Object.assign({ paciente_id: enCatalogo('PAC-000002') ? 'PAC-000002' : null, paciente_nombre: 'Laura Méndez Olvera', fecha_nacimiento: '1991-07-22', procedimiento: 'Hernioplastía umbilical', medico_cirujano_id: 'dr_arturo', sala: 'QX_GRANDE', tipo_estancia: 'HOSPITALARIA', indicaciones_preoperatorias: 'Valoración preanestésica pendiente. Ayuno de 8 horas.', notas: 'Acompañante: esposo.', anestesiologo_id: null, anestesiologo_nombre: '' }, citaQuirurgica(2, 10, 30, 90)),
            Object.assign({ paciente_id: null, paciente_nombre: 'Héctor Salas Mejía', fecha_nacimiento: '1962-11-30', procedimiento: 'Creación de fístula arteriovenosa en antebrazo', medico_cirujano_id: 'dr_roberto', sala: 'QX_GRANDE', tipo_estancia: 'HOSPITALARIA', indicaciones_preoperatorias: 'Paciente en hemodiálisis. Requiere cama de hospitalización posterior.', notas: 'Pendiente pago del deducible.' }, citaQuirurgica(4, 13, 0, 120), conAna)
        ].map((c, k) => Object.assign({
            cirugia_id: 'CX-DEMO-' + (k + 1), medico_cirujano_nombre: (USUARIOS[c.medico_cirujano_id] || {}).nombre || '',
            estatus: 'programada', programada_por_id: 'administrador', programada_por_nombre: (USUARIOS.administrador || {}).nombre || 'Adm. Sofía', creado_en: new Date().toISOString(),
            turno_id: null, ingresado_en: null
        }, c));
        return escribir(CLAVES.cirugias, lista);
    }
    function completarAnestesiologoCirugias() {
        const lista = listarCirugias();
        let cambio = false;
        lista.forEach(c => {
            if (c.anestesiologo_id && !c.anestesiologo_nombre && USUARIOS[c.anestesiologo_id]) { c.anestesiologo_nombre = USUARIOS[c.anestesiologo_id].nombre; cambio = true; }
            if (!c.medico_cirujano_nombre && USUARIOS[c.medico_cirujano_id]) { c.medico_cirujano_nombre = USUARIOS[c.medico_cirujano_id].nombre; cambio = true; }
        });
        return cambio ? escribir(CLAVES.cirugias, lista) : false;
    }
    // Una sola vez: completa sala, duración y jornada de las cirugías ya guardadas, y deja una demo sin anestesiólogo.
    function migrarCirugiasFase1() {
        const lista = listarCirugias();
        if (!lista.length) return false;
        const primera = localStorage.getItem('belen_qx_fase1') !== '1';
        lista.forEach(c => {
            estructurarCirugia(c);
            if (!primera || String(c.cirugia_id).indexOf('CX-DEMO-') !== 0) return;
            if (c.cirugia_id === 'CX-DEMO-1') {
                c.sala = 'QX_GRANDE'; c.tipo_estancia = 'HOSPITALARIA';
                c.indicaciones_preoperatorias = c.indicaciones_preoperatorias || 'Ayuno de 8 horas. Tricotomía. Laboratorios previos.';
                const ini = minutosInicioCirugia(c), fin = minutosFinCirugia(c);
                if (ini === null || ini < QX_DIA_INICIO || fin > QX_DIA_FIN) Object.assign(c, citaQuirurgica(1, 7, 0, 90));
            }
            if (c.cirugia_id === 'CX-DEMO-2' && !c.ingresado_en) {
                Object.assign(c, citaQuirurgica(1, 9, 0, 60), { sala: 'QX_CHICO', tipo_estancia: 'AMBULATORIA' });
                c.indicaciones_preoperatorias = c.indicaciones_preoperatorias || 'Ayuno de 8 horas. Ingreso y egreso el mismo día, sin cama de piso.';
            }
            if (c.cirugia_id === 'CX-DEMO-3') {
                Object.assign(c, citaQuirurgica(2, 10, 30, 90), { sala: 'QX_GRANDE', tipo_estancia: 'HOSPITALARIA', anestesiologo_id: null, anestesiologo_nombre: '' });
                c.indicaciones_preoperatorias = c.indicaciones_preoperatorias || 'Valoración preanestésica pendiente. Ayuno de 8 horas.';
            }
            if (c.cirugia_id === 'CX-DEMO-4') {
                c.sala = 'QX_GRANDE'; c.tipo_estancia = 'HOSPITALARIA';
                const ini = minutosInicioCirugia(c), fin = minutosFinCirugia(c);
                if (ini === null || ini < QX_DIA_INICIO || fin > QX_DIA_FIN) Object.assign(c, citaQuirurgica(4, 13, 0, 120));
                else c.duracion_minutos = c.duracion_minutos || 120;
                c.indicaciones_preoperatorias = c.indicaciones_preoperatorias || 'Paciente en hemodiálisis. Requiere cama de hospitalización posterior.';
            }
        });
        const ok = escribir(CLAVES.cirugias, lista);
        localStorage.setItem('belen_qx_fase1', '1');
        return ok;
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
        { codigo: 'MATERIAL_CURACION', nombre: 'Material de curación' }
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
    const CATEGORIAS_ALMACEN = CATEGORIAS_FARMACIA.filter(c => CATEGORIAS_FISICAS.indexOf(c.codigo) >= 0);
    const SKUS_FUERA_DE_ALMACEN = ['INY-01', 'CON-01', 'NEB-01', 'EKG-01', 'DEX-01', 'LAB-BH', 'LAB-QS', 'LAB-ES', 'RX-ABD', 'RX-TORAX', 'IM-01', 'BH', 'QS6', 'ES', 'TP-TPT', 'EGO', 'GS-RH', 'PC', 'GAS', 'USG-ABD', 'USG-OBS', 'EKG', 'DEX', 'CUR-MEN', 'INY', 'NEB', 'QX-SALA', 'HOSP-NOCHE', 'OBS-HORA'];
    const CLASIFICACION_AWARE = [
        { codigo: 'ACCESO', nombre: 'Grupo Acceso (1ra línea: Amoxicilina, Cefalexina, Metronidazol...)' },
        { codigo: 'VIGILANCIA', nombre: 'Grupo Vigilancia (Amplio espectro: Ceftriaxona, Ciprofloxacino, Meropenem...)' },
        { codigo: 'RESERVA', nombre: 'Grupo Reserva (Último recurso: Linezolid, Colistina...)' }
    ];
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
        'SUT-01': { forma_farmaceutica: 'MATERIAL', via_administracion: 'NA', conservacion: 'AMBIENTE', proveedor: 'Dimsa' }
    };
    const META_SKU_FARMACIA = {
        'CEF-1G': { laboratorio: 'Pisa', categoria: 'MEDICAMENTO', fraccion_cofepris: 'IV_ANTIBIOTICO', clasificacion_aware: 'ACCESO', piezas_por_caja: 1, aplica_iva: false },
        'SOL-1000': { laboratorio: 'Pisa', categoria: 'MEDICAMENTO', fraccion_cofepris: 'VI', piezas_por_caja: 1, aplica_iva: false },
        'FIS-1000': { laboratorio: 'Pisa', categoria: 'MEDICAMENTO', fraccion_cofepris: 'VI', piezas_por_caja: 1, aplica_iva: false },
        'PAR-1G': { laboratorio: 'Pisa', categoria: 'MEDICAMENTO', fraccion_cofepris: 'VI', piezas_por_caja: 1, aplica_iva: false },
        'CUR-01': { laboratorio: 'Genérico', categoria: 'MATERIAL_CURACION', fraccion_cofepris: 'NA', piezas_por_caja: 1, aplica_iva: true },
        'MAT-01': { laboratorio: 'Genérico', categoria: 'MATERIAL_CURACION', fraccion_cofepris: 'NA', piezas_por_caja: 1, aplica_iva: true },
        'SUT-01': { laboratorio: 'Ethicon', categoria: 'MATERIAL_CURACION', fraccion_cofepris: 'NA', piezas_por_caja: 1, aplica_iva: true },
        'FEN-50': { laboratorio: 'Pisa', categoria: 'MEDICAMENTO', fraccion_cofepris: 'I', piezas_por_caja: 5, aplica_iva: false, forma_farmaceutica: 'SOLUCION_INYECTABLE', via_administracion: 'IV' },
        'MID-5': { laboratorio: 'Pisa', categoria: 'MEDICAMENTO', fraccion_cofepris: 'II', piezas_por_caja: 1, aplica_iva: false, forma_farmaceutica: 'SOLUCION_INYECTABLE', via_administracion: 'IV' },
        'PRO-200': { laboratorio: 'Pisa', categoria: 'MEDICAMENTO', fraccion_cofepris: 'IV', piezas_por_caja: 1, aplica_iva: false, forma_farmaceutica: 'SOLUCION_INYECTABLE', via_administracion: 'IV' },
        'BUP-05': { laboratorio: 'Pisa', categoria: 'MEDICAMENTO', fraccion_cofepris: 'VI', piezas_por_caja: 1, aplica_iva: false, forma_farmaceutica: 'SOLUCION_INYECTABLE', via_administracion: 'NA' },
        'DIA-10': { laboratorio: 'Roche', categoria: 'MEDICAMENTO', fraccion_cofepris: 'II', piezas_por_caja: 1, aplica_iva: false },
        'GUA-M': { laboratorio: 'Ambiderm', categoria: 'MATERIAL_CURACION', fraccion_cofepris: 'NA', piezas_por_caja: 1, aplica_iva: true },
        'JER-10': { laboratorio: 'BD', categoria: 'MATERIAL_CURACION', fraccion_cofepris: 'NA', piezas_por_caja: 1, aplica_iva: true },
        'VEN-18': { laboratorio: 'Pisa', categoria: 'MATERIAL_CURACION', fraccion_cofepris: 'NA', piezas_por_caja: 1, aplica_iva: true },
        'PUN-18': { laboratorio: 'BD', categoria: 'MATERIAL_CURACION', fraccion_cofepris: 'NA', piezas_por_caja: 1, aplica_iva: true }
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
    const MODOS_IVA = [
        { codigo: 'items', nombre: 'Aplicar 16% sobre los ítems gravables individuales' },
        { codigo: 'total', nombre: 'Aplicar 16% sobre el Total Neto de la Cuenta / Paquete Promocional' },
        { codigo: 'manual', nombre: 'Definir monto base gravable manualmente' }
    ];
    function desgloseFiscal(cargos, conFactura, opciones) {
        const op = opciones || {};
        const lista = cargos || [];
        const subtotal = redondearMoneda(lista.reduce((s, c) => s + Number(c.subtotal || 0), 0));
        let modo = ['items', 'total', 'manual'].indexOf(op.modo) >= 0 ? op.modo : 'items';
        let baseGravable = 0;
        if (conFactura && modo === 'total') baseGravable = redondearMoneda(Math.max(0, subtotal));
        else if (conFactura && modo === 'manual') {
            const n = redondearMoneda(op.base_manual);
            baseGravable = Number.isFinite(n) && n > 0 ? n : 0;
        } else if (conFactura) {
            modo = 'items';
            baseGravable = redondearMoneda(lista.reduce((s, c) => s + (c && c.aplica_iva ? Number(c.subtotal || 0) : 0), 0));
            if (baseGravable < 0) baseGravable = 0;
        } else modo = 'items';
        const iva = conFactura ? redondearMoneda(baseGravable * 0.16) : 0;
        return { subtotal: subtotal, base_gravable: baseGravable, iva: iva, total: redondearMoneda(subtotal + iva), requirio_factura: !!conFactura, modo_iva: modo };
    }
    function codigoDeLista(lista, valor, fallback) { return lista.some(x => x.codigo === valor) ? valor : fallback; }
    function formaPorCategoria(categoria) {
        if (categoria === 'MATERIAL_CURACION') return 'MATERIAL';
        return 'TABLETA';
    }
    function loteFueraDeAlmacen(p) {
        if (!p) return true;
        const sku = String(p.sku || '').toUpperCase();
        if (SKUS_FUERA_DE_ALMACEN.indexOf(sku) >= 0) return true;
        if (p.forma_farmaceutica === 'ESTUDIO') return true;
        const cat = String(p.categoria || '');
        if (cat && CATEGORIAS_FISICAS.indexOf(cat) < 0) return true;
        return false;
    }
    function completarLote(p) {
        const meta = Object.assign({}, META_SKU_FARMACIA[p.sku] || {}, FEUM_SKU[p.sku] || {});
        const categoria = CATEGORIAS_FISICAS.indexOf(p.categoria) >= 0 ? p.categoria : (CATEGORIAS_FISICAS.indexOf(meta.categoria) >= 0 ? meta.categoria : 'MEDICAMENTO');
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
            clasificacion_aware: CLASIFICACION_AWARE.some(a => a.codigo === (p.clasificacion_aware || meta.clasificacion_aware)) ? (p.clasificacion_aware || meta.clasificacion_aware) : '',
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
    function esInsumoFisico(p) { return !!p && !loteFueraDeAlmacen(p); }
    function badgeRecetaMedica(fraccion) {
        if (fraccion === 'I') return '⚠️ Requiere Receta Médica — Fracción I';
        if (fraccion === 'II') return '⚠️ Requiere Receta Médica — Fracción II';
        if (fraccion === 'III') return '⚠️ Requiere Receta Médica — Fracción III';
        if (fraccion === 'IV_ANTIBIOTICO') return '⚠️ Requiere Receta Médica — Fracción IV Antibiótico';
        return '';
    }
    function puedeEmitirRecetaMedica(rol) { return rol === 'medico' || rol === 'admin'; }
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
        return listarFarmacia().filter(esInsumoFisico).map(p => {
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
        return listarFarmacia().filter(p => esInsumoFisico(p) && p.stock > 0 && String(p.caducidad) >= hoyLocal() && (normalizar(p.sku).indexOf(n) >= 0 || normalizar(p.nombre).indexOf(n) >= 0 || normalizar(p.nombre_comercial).indexOf(n) >= 0 || normalizar(p.lote).indexOf(n) >= 0))
            .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es') || String(a.caducidad).localeCompare(String(b.caducidad))).slice(0, 12);
    }
    function validarIngresoFarmacia(entrada) {
        const categoria = String(entrada.categoria || '').trim();
        const material = categoria === 'MATERIAL_CURACION';
        let sku = limpiarEspacios(entrada.sku).toUpperCase();
        if (material && !sku) sku = ('MAT-' + Date.now().toString(36).toUpperCase()).replace(/[^A-Z0-9-]/g, '').slice(0, 20);
        const nombre = limpiarEspacios(entrada.nombre);
        const nombreComercial = material ? '' : limpiarEspacios(entrada.nombre_comercial);
        const laboratorio = limpiarEspacios(entrada.laboratorio);
        const proveedor = material ? '' : limpiarEspacios(entrada.proveedor);
        const factura = limpiarEspacios(entrada.numero_factura).toUpperCase();
        const forma = material ? 'MATERIAL' : String(entrada.forma_farmaceutica || '').trim();
        const concentracion = material ? '' : limpiarEspacios(entrada.concentracion);
        const via = material ? 'NA' : String(entrada.via_administracion || 'NA').trim();
        const conservacion = material ? 'AMBIENTE' : String(entrada.conservacion || 'AMBIENTE').trim();
        const fraccion = material ? 'NA' : String(entrada.fraccion_cofepris || 'NA').trim();
        const aware = (!material && fraccion === 'IV_ANTIBIOTICO') ? String(entrada.clasificacion_aware || '').trim() : '';
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
        if (nombre.length < 2 || nombre.length > 80) errores.nombre = material ? 'Escriba el nombre del insumo (2 a 80 caracteres).' : 'Escriba el principio activo (2 a 80 caracteres).';
        if (nombreComercial.length > 80) errores.nombre_comercial = 'El nombre comercial admite hasta 80 caracteres.';
        if (laboratorio.length < 2 || laboratorio.length > 40) errores.laboratorio = 'Escriba el laboratorio (2 a 40 caracteres).';
        if (proveedor.length > 60) errores.proveedor = 'El proveedor admite hasta 60 caracteres.';
        if (factura && !/^[A-Z0-9][A-Z0-9-]{0,29}$/.test(factura)) errores.numero_factura = 'El folio usa letras, números o guiones.';
        if (!CATEGORIAS_ALMACEN.some(c => c.codigo === categoria)) errores.categoria = 'En almacén solo entra medicamento o material de curación.';
        if (!material && !FORMAS_FARMACEUTICAS.some(f => f.codigo === forma)) errores.forma_farmaceutica = 'Seleccione la forma farmacéutica.';
        if (concentracion.length > 40) errores.concentracion = 'La concentración admite hasta 40 caracteres.';
        if (!VIAS_ADMINISTRACION.some(v => v.codigo === via)) errores.via_administracion = 'Seleccione la vía.';
        if (!CONSERVACIONES.some(c => c.codigo === conservacion)) errores.conservacion = 'Seleccione la conservación.';
        if (!material && !FRACCIONES_COFEPRIS.some(f => f.codigo === fraccion)) errores.fraccion_cofepris = 'Seleccione la fracción COFEPRIS.';
        if (!material && fraccion === 'IV_ANTIBIOTICO' && !CLASIFICACION_AWARE.some(a => a.codigo === aware)) errores.clasificacion_aware = 'Seleccione la clasificación AWaRe.';
        if (!Number.isInteger(piezas) || piezas < 1 || piezas > 100) errores.piezas_por_caja = 'Indique de 1 a 100 piezas por caja.';
        if (modoCajas && (!Number.isInteger(cajas) || cajas < 1 || cajas > 9999)) errores.numero_cajas = 'Indique de 1 a 9,999 cajas.';
        if (!/^[A-Z0-9][A-Z0-9-]{0,29}$/.test(lote)) errores.lote = 'Escriba el lote (letras, números o guiones).';
        if (!parseFechaISO(caducidad)) errores.caducidad = 'Indique una fecha de caducidad válida.';
        if (!Number.isInteger(stock) || stock < 1 || stock > 99999) errores.stock = 'El total de piezas debe quedar entre 1 y 99,999.';
        if (!Number.isFinite(precio) || precio < 0.01 || precio > 999999.99) errores.precio_unitario = 'Indique un precio entre $0.01 y $999,999.99.';
        const valores = completarLote({
            sku: sku, nombre: nombre, nombre_comercial: nombreComercial, laboratorio: laboratorio, proveedor: proveedor, numero_factura: factura,
            categoria: categoria, forma_farmaceutica: forma, concentracion: concentracion, via_administracion: via, conservacion: conservacion,
            fraccion_cofepris: fraccion, clasificacion_aware: aware, piezas_por_caja: piezas, lote: lote, caducidad: caducidad, stock: stock, precio_unitario: precio, aplica_iva: aplica
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
    function actualizarInsumo(loteId, entrada, s) {
        if (!puedeGestionarFarmacia(s)) return { ok: false, motivo: 'Su perfil no puede editar el inventario.' };
        const lista = listarFarmacia();
        const ya = lista.find(p => p.lote_id === loteId);
        if (!ya || !esInsumoFisico(ya)) return { ok: false, motivo: 'No se encontró el insumo.' };
        const r = validarIngresoFarmacia(Object.assign({}, entrada, { modo_stock: 'piezas', stock: Math.max(1, ya.stock), sku: ya.sku, lote: entrada.lote || ya.lote }));
        if (!r.ok) return { ok: false, motivo: 'Revise los campos marcados.', errores: r.errores };
        if (lista.some(p => p !== ya && normalizar(p.sku) === normalizar(r.valores.sku) && normalizar(p.lote) === normalizar(r.valores.lote))) return { ok: false, motivo: 'Ya existe otro lote con ese código y número de lote.' };
        Object.assign(ya, r.valores, { lote_id: ya.lote_id, stock: ya.stock });
        return escribir(CLAVES.farmacia, lista) ? { ok: true, producto: ya } : { ok: false, motivo: 'No se pudo guardar el insumo.' };
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
            cargado_por_id: quien.id, cargado_por_nombre: quien.nombre,
            folio_receta: extra && extra.folio_receta ? limpiarEspacios(extra.folio_receta).toUpperCase() : '',
            medico_prescriptor_id: extra && extra.medico_prescriptor_id || '',
            medico_prescriptor_nombre: extra && extra.medico_prescriptor_nombre || ''
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

    const TIPOS_ESTUDIO = [
        { codigo: 'LABORATORIO', nombre: 'Laboratorio' },
        { codigo: 'PATOLOGIA', nombre: 'Patología / Biopsia' },
        { codigo: 'IMAGENOLOGIA', nombre: 'Imagenología' },
        { codigo: 'PROCEDIMIENTO', nombre: 'Procedimiento' },
        { codigo: 'HOSPITALIZACION', nombre: 'Hospitalización' }
    ];
    const RECIPIENTES_MUESTRA = [
        'Tubo Lila (EDTA)',
        'Tubo Rojo (Suero)',
        'Tubo Amarillo (Gel)',
        'Tubo Azul (Citrato)',
        'Hisopo / Medio de transporte (Exudado)',
        'Jeringa heparinizada / Líquido de punción',
        'Frasco estéril (Orina / Heces)',
        'Frasco con Formol (Biopsia / Pieza Patológica)',
        'Laminilla / Citología'
    ];
    const SEMILLA_ESTUDIOS = [
        { estudio_id: 'EST-BH', codigo: 'BH', nombre: 'Biometría Hemática (BH)', categoria: 'LABORATORIO', tubo_muestra: 'Tubo Lila (EDTA)', precio_unitario: 350, aplica_iva: true },
        { estudio_id: 'EST-QS6', codigo: 'QS6', nombre: 'Química Sanguínea 6 elem. (QS6)', categoria: 'LABORATORIO', tubo_muestra: 'Tubo Rojo/Amarillo', precio_unitario: 550, aplica_iva: true },
        { estudio_id: 'EST-ES', codigo: 'ES', nombre: 'Electrolitos Séricos (ES)', categoria: 'LABORATORIO', tubo_muestra: 'Tubo Rojo', precio_unitario: 480, aplica_iva: true },
        { estudio_id: 'EST-TP-TPT', codigo: 'TP-TPT', nombre: 'Tiempos de Coagulación (TP y TPT)', categoria: 'LABORATORIO', tubo_muestra: 'Tubo Azul', precio_unitario: 420, aplica_iva: true },
        { estudio_id: 'EST-EGO', codigo: 'EGO', nombre: 'Examen General de Orina (EGO)', categoria: 'LABORATORIO', tubo_muestra: 'Frasco estéril', precio_unitario: 220, aplica_iva: true },
        { estudio_id: 'EST-GS-RH', codigo: 'GS-RH', nombre: 'Grupo Sanguíneo y Rh', categoria: 'LABORATORIO', tubo_muestra: 'Tubo Lila (EDTA)', precio_unitario: 280, aplica_iva: true },
        { estudio_id: 'EST-PC', codigo: 'PC', nombre: 'Prueba Cruzada', categoria: 'LABORATORIO', tubo_muestra: 'Tubo Lila (EDTA)', precio_unitario: 650, aplica_iva: true },
        { estudio_id: 'EST-GAS', codigo: 'GAS', nombre: 'Gasometría Arterial', categoria: 'LABORATORIO', tubo_muestra: 'Jeringa heparinizada', precio_unitario: 850, aplica_iva: true },
        { estudio_id: 'EST-RX-TORAX', codigo: 'RX-TORAX', nombre: 'Radiografía PA de Tórax', categoria: 'IMAGENOLOGIA', tubo_muestra: 'N/A', precio_unitario: 650, aplica_iva: true },
        { estudio_id: 'EST-RX-ABD', codigo: 'RX-ABD', nombre: 'Rx Simple de Abdomen 2 posiciones', categoria: 'IMAGENOLOGIA', tubo_muestra: 'N/A', precio_unitario: 850, aplica_iva: true },
        { estudio_id: 'EST-USG-ABD', codigo: 'USG-ABD', nombre: 'Ultrasonido (USG) Abdominal / Pélvico', categoria: 'IMAGENOLOGIA', tubo_muestra: 'N/A', precio_unitario: 1200, aplica_iva: true },
        { estudio_id: 'EST-USG-OBS', codigo: 'USG-OBS', nombre: 'USG Obstétrico', categoria: 'IMAGENOLOGIA', tubo_muestra: 'N/A', precio_unitario: 1100, aplica_iva: true },
        { estudio_id: 'EST-EKG', codigo: 'EKG', nombre: 'Electrocardiograma (EKG) de 12 derivaciones', categoria: 'PROCEDIMIENTO', tubo_muestra: 'N/A', precio_unitario: 600, aplica_iva: true },
        { estudio_id: 'EST-DEX', codigo: 'DEX', nombre: 'Toma de Dextrostix / Glucemia capilar', categoria: 'PROCEDIMIENTO', tubo_muestra: 'N/A', precio_unitario: 80, aplica_iva: true },
        { estudio_id: 'EST-CUR-MEN', codigo: 'CUR-MEN', nombre: 'Curación menor', categoria: 'PROCEDIMIENTO', tubo_muestra: 'N/A', precio_unitario: 350, aplica_iva: true },
        { estudio_id: 'EST-INY', codigo: 'INY', nombre: 'Aplicación de inyección IM/IV', categoria: 'PROCEDIMIENTO', tubo_muestra: 'N/A', precio_unitario: 120, aplica_iva: true },
        { estudio_id: 'EST-NEB', codigo: 'NEB', nombre: 'Nebulización', categoria: 'PROCEDIMIENTO', tubo_muestra: 'N/A', precio_unitario: 200, aplica_iva: true },
        { estudio_id: 'EST-QX-SALA', codigo: 'QX-SALA', nombre: 'Uso de Quirófano / Sala', categoria: 'HOSPITALIZACION', tubo_muestra: 'N/A', precio_unitario: 4500, aplica_iva: true },
        { estudio_id: 'EST-HOSP-NOCHE', codigo: 'HOSP-NOCHE', nombre: 'Noche de Hospitalización', categoria: 'HOSPITALIZACION', tubo_muestra: 'N/A', precio_unitario: 2500, aplica_iva: true },
        { estudio_id: 'EST-OBS-ESTANCIA', codigo: 'OBS-ESTANCIA', nombre: 'Estancia en Observación', categoria: 'HOSPITALIZACION', tubo_muestra: 'N/A', precio_unitario: 1200, aplica_iva: true },
        { estudio_id: 'EST-REC-ESTANCIA', codigo: 'REC-ESTANCIA', nombre: 'Estancia en Recuperación', categoria: 'HOSPITALIZACION', tubo_muestra: 'N/A', precio_unitario: 1800, aplica_iva: true },
        { estudio_id: 'EST-OBS-HORA', codigo: 'OBS-HORA', nombre: 'Hora en Observación', categoria: 'HOSPITALIZACION', tubo_muestra: 'N/A', precio_unitario: 350, aplica_iva: true },
        { estudio_id: 'EST-BX-CH', codigo: 'BX-CH', nombre: 'Biopsia / Estudio Histopatológico Pieza Chica', categoria: 'PATOLOGIA', tubo_muestra: 'Frasco con Formol (Biopsia / Pieza Patológica)', precio_unitario: 1500, aplica_iva: true },
        { estudio_id: 'EST-BX-MD', codigo: 'BX-MD', nombre: 'Biopsia / Estudio Histopatológico Pieza Mediana', categoria: 'PATOLOGIA', tubo_muestra: 'Frasco con Formol (Biopsia / Pieza Patológica)', precio_unitario: 2200, aplica_iva: true },
        { estudio_id: 'EST-BX-GD', codigo: 'BX-GD', nombre: 'Biopsia / Estudio Histopatológico Pieza Grande', categoria: 'PATOLOGIA', tubo_muestra: 'Frasco con Formol (Biopsia / Pieza Patológica)', precio_unitario: 3200, aplica_iva: true }
    ];
    const ALIAS_SKU_ESTUDIO = { 'LAB-BH': 'BH', 'LAB-QS': 'QS6', 'LAB-ES': 'ES', 'EKG-01': 'EKG', 'DEX-01': 'DEX', 'INY-01': 'INY', 'IM-01': 'INY', 'NEB-01': 'NEB' };
    const CODIGOS_ESTUDIO_RETIRADOS = Object.keys(ALIAS_SKU_ESTUDIO).concat(['CON-01']);
    function puedeGestionarTarifario(s) { return !!s && (s.rol === 'admin' || s.rol === 'administrador'); }
    function puedeAlterarMontoEstudio(s) { return !!s && s.rol === 'admin'; }
    function puedeAjustarCuenta(s) { return puedeGestionarTarifario(s); }
    function fichaEstudio(e) {
        const categoria = TIPOS_ESTUDIO.some(t => t.codigo === (e.categoria || e.tipo)) ? (e.categoria || e.tipo) : 'PROCEDIMIENTO';
        const aplica = typeof e.aplica_iva === 'boolean' ? e.aplica_iva : true;
        return {
            estudio_id: e.estudio_id, codigo: String(e.codigo || '').toUpperCase(), nombre: e.nombre,
            categoria: categoria, tipo: categoria, tubo_muestra: limpiarEspacios(e.tubo_muestra || 'N/A') || 'N/A',
            precio_unitario: redondearMoneda(e.precio_unitario), aplica_iva: aplica
        };
    }
    function listarEstudios() { return leer(CLAVES.estudios, []).map(fichaEstudio); }
    function estudioPorCodigo(codigo) { return listarEstudios().find(e => normalizar(e.codigo) === normalizar(codigo)) || null; }
    function estudioPorId(id) { return listarEstudios().find(e => e.estudio_id === id) || null; }
    function nombreTipoEstudio(codigo) { const t = TIPOS_ESTUDIO.find(x => x.codigo === codigo); return t ? t.nombre : (codigo || ''); }
    function estudiosPorCategoria(categoria) {
        const lista = listarEstudios();
        if (!categoria) return lista;
        return lista.filter(e => e.categoria === categoria);
    }
    function ivaExplicito(valor, porDefecto) {
        if (valor === undefined || valor === null || valor === '') return porDefecto;
        return valor === true || valor === 'true' || valor === '1' || valor === 'on';
    }
    function migrarPaquetesAEstudios() {
        const lista = listarPaquetes();
        let cambio = false;
        lista.forEach(p => {
            const antes = (p.items || []).length;
            p.items = (p.items || []).map(it => {
                const dest = ALIAS_SKU_ESTUDIO[String(it.sku || '').toUpperCase()];
                if (!dest || dest === it.sku) return it;
                cambio = true;
                return Object.assign({}, it, { sku: dest });
            }).filter(it => String(it.sku || '').toUpperCase() !== 'CON-01');
            if (p.items.length !== antes) cambio = true;
        });
        if (cambio) escribir(CLAVES.paquetes, lista);
    }
    function consolidarCatalogoEstudios() {
        const primera = localStorage.getItem(CLAVES.estudiosV3) === null;
        const crudos = leer(CLAVES.estudios, []).map(fichaEstudio);
        let lista = crudos.filter(e => CODIGOS_ESTUDIO_RETIRADOS.indexOf(e.codigo) < 0);
        let cambio = lista.length !== crudos.length;
        if (primera) {
            SEMILLA_ESTUDIOS.forEach(s => {
                const i = lista.findIndex(x => normalizar(x.codigo) === normalizar(s.codigo));
                if (i >= 0) lista[i] = fichaEstudio(Object.assign({}, s, { estudio_id: lista[i].estudio_id }));
                else lista.push(fichaEstudio(s));
            });
            escribir(CLAVES.estudios, lista);
            escribir(CLAVES.estudiosV3, true);
        } else {
            SEMILLA_ESTUDIOS.forEach(s => {
                if (!lista.some(x => normalizar(x.codigo) === normalizar(s.codigo))) { lista.push(fichaEstudio(s)); cambio = true; }
            });
            if (cambio) escribir(CLAVES.estudios, lista);
        }
        migrarPaquetesAEstudios();
    }
    function validarEstudio(entrada) {
        const nombre = limpiarEspacios(entrada.nombre);
        const categoria = String(entrada.categoria || entrada.tipo || '').trim();
        const codigo = limpiarEspacios(entrada.codigo).toUpperCase();
        const pideMuestra = categoria === 'LABORATORIO' || categoria === 'PATOLOGIA';
        let tubo = pideMuestra ? (limpiarEspacios(entrada.tubo_muestra || '') || '') : 'N/A';
        const precio = redondearMoneda(String(entrada.precio_unitario == null ? '' : entrada.precio_unitario).trim().replace(',', '.'));
        const errores = {};
        if (nombre.length < 2 || nombre.length > 80) errores.nombre = 'Escriba el nombre del estudio (2 a 80 caracteres).';
        if (!TIPOS_ESTUDIO.some(t => t.codigo === categoria)) errores.categoria = 'Seleccione laboratorio, patología, imagen, procedimiento u hospitalización.';
        if (codigo && !/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(codigo)) errores.codigo = 'El código usa de 2 a 20 letras, números o guiones.';
        if (pideMuestra && (!tubo || normalizar(tubo) === 'n/a' || normalizar(tubo) === 'na')) errores.tubo_muestra = 'Seleccione el tubo, recipiente o tipo de muestra.';
        if (tubo.length > 80) errores.tubo_muestra = 'El tubo o la muestra admite hasta 80 caracteres.';
        if (!Number.isFinite(precio) || precio < 0.01 || precio > 999999.99) errores.precio_unitario = 'Indique un precio entre $0.01 y $999,999.99.';
        return { ok: Object.keys(errores).length === 0, errores: errores, valores: { nombre: nombre, categoria: categoria, codigo: codigo, tubo_muestra: tubo, precio_unitario: precio, aplica_iva: ivaExplicito(entrada.aplica_iva, true) } };
    }
    function guardarEstudio(entrada, s) {
        if (!puedeGestionarTarifario(s)) return { ok: false, motivo: 'Solo dirección y caja pueden modificar el tarifario.' };
        const r = validarEstudio(entrada);
        if (!r.ok) return { ok: false, motivo: 'Revise los campos marcados.', errores: r.errores };
        const lista = listarEstudios();
        const id = entrada.estudio_id;
        const ya = id ? lista.find(e => e.estudio_id === id) : null;
        if (id && !ya) return { ok: false, motivo: 'No se encontró el estudio.' };
        const codigo = r.valores.codigo || (ya && ya.codigo) || ('EST-' + Date.now().toString(36).toUpperCase()).replace(/[^A-Z0-9-]/g, '').slice(0, 20);
        if (lista.some(e => e !== ya && normalizar(e.codigo) === normalizar(codigo))) return { ok: false, motivo: 'Ese código ya está en el catálogo.' };
        const ficha = fichaEstudio({ estudio_id: ya ? ya.estudio_id : uid('EST'), codigo: codigo, nombre: r.valores.nombre, categoria: r.valores.categoria, tubo_muestra: r.valores.tubo_muestra, precio_unitario: r.valores.precio_unitario, aplica_iva: r.valores.aplica_iva });
        if (ya) Object.assign(ya, ficha); else lista.push(ficha);
        return escribir(CLAVES.estudios, lista) ? { ok: true, estudio: ficha } : { ok: false, motivo: 'No se pudo guardar el estudio.' };
    }
    function eliminarEstudio(id, s) {
        if (!puedeGestionarTarifario(s)) return { ok: false, motivo: 'Solo dirección y caja pueden modificar el tarifario.' };
        const lista = listarEstudios();
        if (!lista.some(e => e.estudio_id === id)) return { ok: false, motivo: 'No se encontró el estudio.' };
        return escribir(CLAVES.estudios, lista.filter(e => e.estudio_id !== id)) ? { ok: true } : { ok: false, motivo: 'No se pudo eliminar el estudio.' };
    }
    function colorTubo(tubo) {
        const n = normalizar(tubo);
        if (!n || n === 'n/a' || n === 'na') return '';
        if (n.indexOf('lila') >= 0 || n.indexOf('edta') >= 0 || n.indexOf('morado') >= 0) return '🟣';
        if (n.indexOf('azul') >= 0) return '🔵';
        if (n.indexOf('rojo') >= 0 && n.indexOf('amarillo') >= 0) return '🟠';
        if (n.indexOf('rojo') >= 0) return '🔴';
        if (n.indexOf('amarillo') >= 0) return '🟡';
        if (n.indexOf('frasco') >= 0) return '🧴';
        if (n.indexOf('jeringa') >= 0) return '💉';
        return '🧪';
    }
    function tuboCuenta(tubo) {
        const t = limpiarEspacios(tubo || '');
        const n = normalizar(t);
        if (!t || n === 'n/a' || n === 'na') return null;
        return t;
    }
    function resumenTubosEstudios(ids) {
        const cuenta = {}, orden = [];
        (ids || []).forEach(id => {
            const est = estudioPorId(id) || estudioPorCodigo(id);
            const tubo = est && tuboCuenta(est.tubo_muestra);
            if (!tubo) return;
            if (!cuenta[tubo]) { cuenta[tubo] = 0; orden.push(tubo); }
            cuenta[tubo] += 1;
        });
        const tubos = orden.map(t => ({ tubo: t, cantidad: cuenta[t], emoji: colorTubo(t) }));
        return { tubos: tubos, texto: tubos.map(t => (t.emoji ? t.emoji + ' ' : '') + t.cantidad + 'x ' + t.tubo).join(', ') };
    }
    function cargoDesdeEstudio(est, cantidad, quien, extra) {
        const cant = cantidad || 1;
        const oficial = redondearMoneda(est.precio_unitario);
        const alterado = !!(extra && extra.precio_alterado);
        const base = alterado ? redondearMoneda(extra.precio_unitario) : oficial;
        const cat = est.categoria || est.tipo;
        return {
            cargo_id: uid('CG'), concepto: est.nombre + (extra && extra.paquete_nombre ? ' · ' + extra.paquete_nombre : ''),
            sku: est.codigo, estudio_id: est.estudio_id, lote: null, lote_id: null, laboratorio: null,
            categoria: cat, tubo_muestra: est.tubo_muestra || 'N/A', fraccion_cofepris: 'NA', aplica_iva: !!est.aplica_iva,
            origen: 'estudio', origen_precio: alterado ? 'ajuste_admin' : 'catalogo_estudios', precio_catalogo: oficial,
            observaciones_toma: extra && extra.observaciones ? limpiarEspacios(extra.observaciones) : '',
            paquete_id: extra && extra.paquete_id || null, paquete_nombre: extra && extra.paquete_nombre || null,
            precio_unitario: base, cantidad: cant, subtotal: redondearMoneda(base * cant),
            fecha_hora: new Date().toISOString(), cargado_en: new Date().toISOString(),
            cargado_por_id: quien.id, cargado_por_nombre: quien.nombre
        };
    }
    function episodioAbiertoParaEstudios(t) {
        if (!t) return false;
        return ESTATUS_EN_FILA.indexOf(t.estatus) >= 0 || t.estatus === ESTATUS.INTERNADO || t.estatus === ESTATUS.INTERNADO_EN_PROCESO;
    }
    function turnoActivoParaEstudios(pista) {
        const p = pista || {};
        if (p.turno_id) {
            const directo = obtenerTurno(p.turno_id);
            if (directo && episodioAbiertoParaEstudios(directo)) return directo;
        }
        if (p.paciente_id) {
            const porId = listarTurnos().find(t => t.paciente_id === p.paciente_id && episodioAbiertoParaEstudios(t));
            if (porId) return porId;
        }
        return null;
    }
    function anexarCargosEstudios(turno, cargos) {
        const i = internamientoDeTurno(turno.turno_id);
        const enPiso = i && (turno.estatus === ESTATUS.INTERNADO || turno.estatus === ESTATUS.INTERNADO_EN_PROCESO);
        if (enPiso) {
            i.cargos = (i.cargos || []).concat(cargos);
            i.cuenta_actual = totalCargos(i.cargos);
            i.cuenta_actual_total = i.cuenta_actual;
            if (!guardarInternamiento(i)) return { ok: false, motivo: 'No se pudo guardar el cargo.' };
        } else {
            const propios = (obtenerTurno(turno.turno_id).cargos || []).concat(cargos);
            if (!actualizarTurno(turno.turno_id, { cargos: propios })) return { ok: false, motivo: 'No se pudo guardar el cargo.' };
        }
        const fresco = obtenerTurno(turno.turno_id);
        const total = totalCargos(cargosDeEpisodio(fresco));
        actualizarTurno(turno.turno_id, { cuenta_actual: total, cuenta_actual_total: total });
        return { ok: true, cargos: cargos, total: total, internamiento: enPiso ? obtenerInternamiento(i.internamiento_id) : null };
    }
    function cargarEstudiosACuenta(turnoId, entrada, s) {
        if (!s || !permisoAccionDe(s.usuario_id, 'cargar_consumos')) return { ok: false, motivo: 'Su perfil no puede cargar estudios.' };
        const t = obtenerTurno(turnoId);
        if (!t) return { ok: false, motivo: 'No se encontró al paciente.' };
        if (!episodioAbiertoParaEstudios(t)) return { ok: false, motivo: 'Este episodio ya no admite cargos de estudios.' };
        const entradaIds = Array.isArray(entrada.estudio_ids) ? entrada.estudio_ids : (entrada.estudio_id ? [entrada.estudio_id] : []);
        if (!entradaIds.length) return { ok: false, motivo: 'Seleccione al menos un estudio o procedimiento.' };
        const obs = limpiarEspacios(entrada.observaciones || '');
        if (obs.length > 240) return { ok: false, motivo: 'Las observaciones admiten hasta 240 caracteres.' };
        const alterar = puedeAlterarMontoEstudio(s);
        const precios = (alterar && entrada.precios) || {};
        const cargos = [];
        const vistos = {};
        for (let k = 0; k < entradaIds.length; k++) {
            const est = estudioPorId(entradaIds[k]) || estudioPorCodigo(entradaIds[k]);
            if (!est) return { ok: false, motivo: 'Un estudio seleccionado ya no está en el catálogo.' };
            if (vistos[est.estudio_id]) continue;
            vistos[est.estudio_id] = true;
            let precio = redondearMoneda(est.precio_unitario);
            let alterado = false;
            const crudo = alterar ? (precios[est.estudio_id] != null ? precios[est.estudio_id] : (entradaIds.length === 1 ? entrada.precio_unitario : null)) : null;
            if (alterar && crudo != null && String(crudo).trim() !== '') {
                const n = redondearMoneda(String(crudo).trim().replace(',', '.'));
                if (!Number.isFinite(n) || n < 0.01 || n > 999999.99) return { ok: false, motivo: 'Indique un precio entre $0.01 y $999,999.99.' };
                if (n !== precio) { precio = n; alterado = true; }
            }
            cargos.push(cargoDesdeEstudio(est, 1, { id: s.usuario_id, nombre: s.nombre }, { precio_unitario: precio, precio_alterado: alterado, observaciones: obs }));
        }
        return anexarCargosEstudios(t, cargos);
    }
    function cargarEstudioACuenta(turnoId, entrada, s) {
        const r = cargarEstudiosACuenta(turnoId, entrada || {}, s);
        if (!r.ok) return r;
        return { ok: true, cargo: r.cargos[0], cargos: r.cargos, total: r.total, internamiento: r.internamiento };
    }
    function metaCargoCuenta(c) {
        const cuando = (c && (c.fecha_hora || c.cargado_en)) || '';
        const d = new Date(cuando);
        const valida = !isNaN(d.getTime());
        const h = valida ? d.getHours() : -1;
        const turno = !valida ? 'Sin turno' : (h >= 7 && h < 15 ? 'Matutino' : (h >= 15 && h < 22 ? 'Vespertino' : 'Nocturno'));
        const dia = valida ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') : '';
        return {
            dia: dia,
            dia_txt: valida ? d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'Sin fecha',
            turno_horario: turno,
            quien: (c && c.cargado_por_nombre) || 'Sin registro',
            cuando: cuando
        };
    }
    function facturaDeTurno(t) {
        if (!t) return false;
        if (t.requiere_factura) return true;
        const i = internamientoDeTurno(t.turno_id);
        return !!(i && i.requiere_factura);
    }
    function cuentasAuditoria(s) {
        if (!puedeAjustarCuenta(s)) return [];
        const abiertos = [ESTATUS.PENDIENTE_SIGNOS, ESTATUS.SIGNOS_CAPTURADOS, ESTATUS.EN_CONSULTA, ESTATUS.INTERNADO_EN_PROCESO, ESTATUS.INTERNADO, ESTATUS.ALTA_PENDIENTE_PAGO];
        return listarTurnos().filter(t => abiertos.indexOf(t.estatus) >= 0).map(t => {
            const f = fichaCuenta(t);
            const on = facturaDeTurno(t);
            const lineas = (f.cargos || []).map(c => Object.assign({}, c, metaCargoCuenta(c)));
            const fiscal = fiscalDeTurno(t);
            return Object.assign(f, {
                lineas: lineas, requiere_factura: on, modo_iva: fiscal.modo_iva, base_gravable_manual: fiscalOpcionesDeTurno(t).base_manual, fiscal: fiscal,
                pendiente_pago: t.estatus === ESTATUS.ALTA_PENDIENTE_PAGO,
                activa: t.estatus !== ESTATUS.ALTA_PENDIENTE_PAGO
            });
        }).sort((a, b) => Number(b.pendiente_pago) - Number(a.pendiente_pago) || String(b.egreso_en || '').localeCompare(String(a.egreso_en || '')));
    }
    function fiscalOpcionesDeTurno(t) {
        const i = t && internamientoDeTurno(t.turno_id);
        const modo = (t && t.modo_iva) || (i && i.modo_iva) || 'items';
        const crudo = t && t.base_gravable_manual != null && t.base_gravable_manual !== '' ? t.base_gravable_manual : (i && i.base_gravable_manual);
        return { modo: ['items', 'total', 'manual'].indexOf(modo) >= 0 ? modo : 'items', base_manual: crudo == null || crudo === '' ? null : crudo };
    }
    function fiscalDeTurno(t) {
        const op = fiscalOpcionesDeTurno(t);
        return desgloseFiscal(cargosDeEpisodio(t), facturaDeTurno(t), { modo: op.modo, base_manual: op.base_manual });
    }
    function establecerFiscalCuenta(turnoId, entrada, s) {
        if (!puedeAjustarCuenta(s)) return { ok: false, motivo: 'Solo dirección y caja pueden marcar la factura.' };
        const t = obtenerTurno(turnoId);
        if (!t || t.estatus === ESTATUS.CERRADO_HISTORICO) return { ok: false, motivo: 'Esta cuenta ya está cerrada.' };
        const op = entrada || {};
        const previo = fiscalOpcionesDeTurno(t);
        const on = op.requiere_factura != null ? !!op.requiere_factura : facturaDeTurno(t);
        const modo = ['items', 'total', 'manual'].indexOf(op.modo_iva) >= 0 ? op.modo_iva : previo.modo;
        let base = op.base_gravable_manual;
        if (base == null || String(base).trim() === '') base = previo.base_manual;
        else {
            base = redondearMoneda(String(base).trim().replace(',', '.'));
            if (!Number.isFinite(base) || base < 0 || base > 999999.99) return { ok: false, motivo: 'El monto base gravable va de $0 a $999,999.99.' };
        }
        const patch = { requiere_factura: on, modo_iva: modo, base_gravable_manual: base };
        if (!actualizarTurno(turnoId, patch)) return { ok: false, motivo: 'No se pudo guardar la factura.' };
        const i = internamientoDeTurno(turnoId);
        if (i) { Object.assign(i, patch); guardarInternamiento(i); }
        const fresco = obtenerTurno(turnoId);
        const fiscal = fiscalDeTurno(fresco);
        return { ok: true, requiere_factura: on, modo_iva: fiscal.modo_iva, base_gravable_manual: base, fiscal: fiscal };
    }
    function establecerFacturaCuenta(turnoId, requiere, s) {
        const t = obtenerTurno(turnoId);
        const previo = fiscalOpcionesDeTurno(t);
        return establecerFiscalCuenta(turnoId, { requiere_factura: requiere, modo_iva: previo.modo, base_gravable_manual: previo.base_manual }, s);
    }
    function recalcularCuentaTurno(turnoId) {
        const i = internamientoDeTurno(turnoId);
        if (i) {
            i.cuenta_actual = totalCargos(i.cargos);
            i.cuenta_actual_total = i.cuenta_actual;
            guardarInternamiento(i);
        }
        const fresco = obtenerTurno(turnoId);
        if (!fresco) return 0;
        const total = totalCargos(cargosDeEpisodio(fresco));
        actualizarTurno(turnoId, { cuenta_actual: total, cuenta_actual_total: total });
        return total;
    }
    function ajustarLineaCuenta(turnoId, cargoId, entrada, s) {
        if (!puedeAjustarCuenta(s)) return { ok: false, motivo: 'Solo dirección y caja pueden ajustar una cuenta.' };
        const t = obtenerTurno(turnoId);
        if (!t || t.estatus === ESTATUS.CERRADO_HISTORICO) return { ok: false, motivo: 'Esta cuenta ya está cerrada.' };
        const i = internamientoDeTurno(turnoId);
        const enInternamiento = i && (i.cargos || []).some(c => c.cargo_id === cargoId);
        const lista = enInternamiento ? i.cargos : (t.cargos || []);
        const idx = lista.findIndex(c => c.cargo_id === cargoId);
        if (idx < 0) return { ok: false, motivo: 'No se encontró el concepto.' };
        const op = entrada || {};
        if (op.eliminar) lista.splice(idx, 1);
        else {
            const c = lista[idx];
            if (op.concepto != null) {
                const concepto = limpiarEspacios(op.concepto);
                if (concepto.length < 2 || concepto.length > 80) return { ok: false, motivo: 'Escriba el concepto (2 a 80 caracteres).' };
                c.concepto = concepto;
            }
            if (op.precio_unitario != null && String(op.precio_unitario).trim() !== '') {
                const n = redondearMoneda(String(op.precio_unitario).trim().replace(',', '.'));
                const descuento = c.origen === 'ajuste_paquete';
                if (!Number.isFinite(n) || (!descuento && (n < 0.01 || n > 999999.99)) || (descuento && (n > -0.01 || n < -999999.99))) return { ok: false, motivo: 'Indique un monto válido.' };
                c.precio_unitario = n;
            }
            if (op.cantidad != null && String(op.cantidad).trim() !== '') {
                const cant = parseInt(op.cantidad, 10);
                if (!Number.isInteger(cant) || cant < 1 || cant > 99) return { ok: false, motivo: 'La cantidad va de 1 a 99.' };
                c.cantidad = cant;
            }
            if (op.aplica_iva != null) c.aplica_iva = ivaExplicito(op.aplica_iva, false);
            c.subtotal = redondearMoneda(Number(c.precio_unitario) * Number(c.cantidad || 1));
            c.ajustado_por_id = s.usuario_id;
            c.ajustado_por_nombre = s.nombre;
            c.ajustado_en = new Date().toISOString();
        }
        if (enInternamiento) {
            if (!guardarInternamiento(i)) return { ok: false, motivo: 'No se pudo guardar el ajuste.' };
        } else if (!actualizarTurno(turnoId, { cargos: lista })) return { ok: false, motivo: 'No se pudo guardar el ajuste.' };
        return { ok: true, total: recalcularCuentaTurno(turnoId) };
    }
    function escHtmlCuenta(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function htmlEstadoCuenta(turnoId) {
        const t = obtenerTurno(turnoId);
        if (!t) return '';
        const f = fichaCuenta(t);
        const on = facturaDeTurno(t);
        const fiscal = fiscalDeTurno(t);
        const etiquetaIva = fiscal.modo_iva === 'total' ? 'IVA 16% sobre el total neto' : (fiscal.modo_iva === 'manual' ? 'IVA 16% sobre base manual ' + formatoMoneda(fiscal.base_gravable) : 'IVA 16% sobre gravables');
        const e = escHtmlCuenta;
        const grupos = [];
        (f.cargos || []).forEach(c => {
            const m = metaCargoCuenta(c);
            const clave = m.dia + '|' + m.turno_horario + '|' + m.quien;
            let g = grupos.find(x => x.clave === clave);
            if (!g) { g = { clave: clave, dia: m.dia_txt, turno: m.turno_horario, quien: m.quien, lineas: [] }; grupos.push(g); }
            g.lineas.push(c);
        });
        const cuerpo = grupos.map(g => {
            const filas = g.lineas.map(c => '<tr><td>' + e(c.concepto) + (c.tubo_muestra && c.tubo_muestra !== 'N/A' ? '<div style="color:#64748b;font-size:11px">' + e(c.tubo_muestra) + '</div>' : '') + (c.observaciones_toma ? '<div style="color:#64748b;font-size:11px">Obs.: ' + e(c.observaciones_toma) + '</div>' : '') + '</td><td style="text-align:right">' + e(formatoMoneda(c.precio_unitario)) + '</td><td style="text-align:center">' + e(c.cantidad || 1) + '</td><td style="text-align:right">' + e(formatoMoneda(c.subtotal)) + '</td><td>' + (c.aplica_iva ? 'Gravable' : 'Tasa 0%') + '</td></tr>').join('');
            return '<h3 style="margin:18px 0 6px;font-size:13px">' + e(g.dia) + ' · ' + e(g.turno) + ' · ' + e(g.quien) + '</h3><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:#f8fafc"><th style="text-align:left;padding:6px;border-bottom:1px solid #e2e8f0">Concepto</th><th style="padding:6px;border-bottom:1px solid #e2e8f0">Precio</th><th style="padding:6px;border-bottom:1px solid #e2e8f0">Cant.</th><th style="padding:6px;border-bottom:1px solid #e2e8f0">Subtotal</th><th style="padding:6px;border-bottom:1px solid #e2e8f0">IVA</th></tr></thead><tbody>' + filas + '</tbody></table>';
        }).join('') || '<p>Sin conceptos cargados.</p>';
        const iva = on
            ? '<p style="display:flex;justify-content:space-between"><span>' + e(etiquetaIva) + '</span><span>' + e(formatoMoneda(fiscal.iva)) + '</span></p><p style="display:flex;justify-content:space-between;font-size:16px"><strong>Total con factura</strong><strong>' + e(formatoMoneda(fiscal.total)) + '</strong></p>'
            : '<p style="display:flex;justify-content:space-between;font-size:16px"><strong>Total sin IVA</strong><strong>' + e(formatoMoneda(fiscal.subtotal)) + '</strong></p><p style="color:#64748b;font-size:12px">Factura no solicitada. El 16% no se suma.</p>';
        return '<div style="margin:32px;font-family:Georgia,serif;color:#0f172a"><h1 style="margin:0;font-size:22px">Sanatorio Belén</h1><h2 style="margin:4px 0 16px;font-weight:normal;color:#64748b;font-size:14px">Estado de cuenta / comprobante desglosado</h2><p><strong>Paciente:</strong> ' + e(f.nombre) + (f.cama ? ' · ' + e(f.cama) : '') + '</p><p><strong>Médico:</strong> ' + e(f.medico_nombre || '') + '</p><p><strong>Estatus:</strong> ' + e(ETIQUETA_ESTATUS[f.estatus] || f.estatus) + '</p>' + cuerpo + '<div style="margin-top:16px;border-top:1px solid #cbd5e1;padding-top:10px;max-width:360px;margin-left:auto"><p style="display:flex;justify-content:space-between"><span>Subtotal</span><span>' + e(formatoMoneda(fiscal.subtotal)) + '</span></p>' + iva + '</div></div>';
    }
    function listarPaquetes() { return leer(CLAVES.paquetes, []); }
    function listarCajas() { return leer(CLAVES.cajasEstupefacientes, []); }
    function validarPaquete(entrada) {
        const nombre = limpiarEspacios(entrada.nombre);
        const items = Array.isArray(entrada.items) ? entrada.items : [];
        const errores = {};
        if (nombre.length < 2 || nombre.length > 80) errores.nombre = 'Escriba el nombre del paquete (2 a 80 caracteres).';
        if (!items.length || items.length > 30) errores.items = 'Agregue de 1 a 30 insumos.';
        let precioPaquete = null;
        if (entrada.precio_paquete != null && String(entrada.precio_paquete).trim() !== '') {
            const n = redondearMoneda(String(entrada.precio_paquete).trim().replace(',', '.'));
            if (!Number.isFinite(n) || n < 0.01 || n > 999999.99) errores.precio_paquete = 'El precio del paquete va de $0.01 a $999,999.99, o déjelo vacío.';
            else precioPaquete = n;
        }
        const limpios = [];
        items.forEach(it => {
            const sku = limpiarEspacios(it.sku).toUpperCase();
            const cantidad = parseInt(it.cantidad, 10);
            const est = estudioPorCodigo(sku);
            const prod = est ? null : productoPorSku(sku);
            if ((!est && !prod) || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > 99) errores.items = 'Cada ítem necesita un código del inventario o del catálogo de estudios y una cantidad de 1 a 99.';
            else if (prod && prod.fraccion_cofepris === 'I') errores.items = 'La fracción I no entra en un paquete. Se carga ámpula por ámpula.';
            else limpios.push({ sku: sku, cantidad: cantidad });
        });
        return { ok: Object.keys(errores).length === 0, errores: errores, valores: { nombre: nombre, items: limpios, precio_paquete: precioPaquete } };
    }
    function guardarPaquete(entrada, s, idExistente) {
        if (!puedeGestionarFarmacia(s)) return { ok: false, motivo: 'Su perfil no puede editar paquetes.' };
        const r = validarPaquete(entrada);
        if (!r.ok) return { ok: false, motivo: 'Revise los campos marcados.', errores: r.errores };
        const lista = listarPaquetes();
        const ya = idExistente ? lista.find(p => p.paquete_id === idExistente) : null;
        if (idExistente && !ya) return { ok: false, motivo: 'No se encontró el paquete.' };
        const ficha = { paquete_id: ya ? ya.paquete_id : uid('PAQ'), nombre: r.valores.nombre, items: r.valores.items, precio_paquete: r.valores.precio_paquete, actualizado_en: new Date().toISOString() };
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
            const est = estudioPorCodigo(item.sku);
            if (est) {
                lineas.push({ estudio_id: est.estudio_id, sku: est.codigo, cantidad: item.cantidad, servicio: true, ignorar_fefo: true, paquete_id: paq.paquete_id, paquete_nombre: paq.nombre });
                continue;
            }
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
    function sumaRealPaquete(items) {
        return redondearMoneda((items || []).reduce((s, it) => {
            const cant = parseInt(it.cantidad, 10) || 0;
            const est = estudioPorCodigo(it.sku);
            const precio = est ? Number(est.precio_unitario) : Number((productoPorSku(it.sku) || {}).precio_unitario || 0);
            return s + precio * cant;
        }, 0));
    }
    function ajusteDescuentoPaquete(cargos) {
        const grupos = {};
        (cargos || []).forEach(c => {
            if (!c || !c.paquete_id || c.origen === 'ajuste_paquete') return;
            if (!grupos[c.paquete_id]) grupos[c.paquete_id] = { nombre: c.paquete_nombre || '', subtotal: 0 };
            grupos[c.paquete_id].subtotal = redondearMoneda(grupos[c.paquete_id].subtotal + Number(c.subtotal || 0));
        });
        const ajustes = [];
        Object.keys(grupos).forEach(id => {
            const paq = listarPaquetes().find(p => p.paquete_id === id);
            if (!paq || paq.precio_paquete == null || paq.precio_paquete === '') return;
            const pactado = redondearMoneda(paq.precio_paquete);
            const suma = grupos[id].subtotal;
            if (!(pactado < suma)) return;
            const diff = redondearMoneda(pactado - suma);
            ajustes.push({
                cargo_id: uid('CG'), concepto: 'Descuento por Paquete ' + grupos[id].nombre + ' (' + formatoMoneda(diff) + ')',
                precio_unitario: diff, cantidad: 1, subtotal: diff, aplica_iva: false,
                origen: 'ajuste_paquete', origen_precio: 'paquete', paquete_id: id, paquete_nombre: grupos[id].nombre,
                sku: null, lote_id: null, fecha_hora: new Date().toISOString(), cargado_en: new Date().toISOString()
            });
        });
        return ajustes;
    }

    function enfermerasActivas() {
        return Object.values(USUARIOS).filter(u => u.activo !== false && (ENFERMERIAS.indexOf(u.rol) >= 0 || u.rol === 'enf_farmacia'))
            .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    }
    function clasificarAreaFarmacia(t) {
        if (!t) return null;
        if (ESTATUS_EN_FILA.indexOf(t.estatus) >= 0) return 'consulta';
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
    const AREAS_CAJA = [
        { codigo: 'QUIROFANO', nombre: 'Quirófano' },
        { codigo: 'HOSPITALIZACION', nombre: 'Hospitalización' },
        { codigo: 'OBSERVACION', nombre: 'Observación' }
    ];
    function nombreAreaCaja(codigo) { const a = AREAS_CAJA.find(x => x.codigo === codigo); return a ? a.nombre : (codigo || ''); }
    function restantesCaja(c) {
        if (!c) return 0;
        if (c.ampulas_restantes != null && c.ampulas_restantes !== '') return Math.max(0, Number(c.ampulas_restantes) || 0);
        return Math.max(0, (Number(c.piezas_por_caja) || 0) - (Number(c.usadas) || 0));
    }
    function etiquetaCajaAbierta(c) {
        const rest = restantesCaja(c);
        const tot = c.ampulas_totales || c.piezas_por_caja || rest;
        return 'Caja ' + c.caja_id + ' — Lote ' + (c.lote || '') + ' — Receta Esp. ' + (c.folio_receta_especial || '') + ' — Área ' + nombreAreaCaja(c.area_destino) + ' — Quedan ' + rest + '/' + tot + ' ámpulas';
    }
    function cajasAbiertasDe(sku, area) {
        return listarCajas().filter(c => normalizar(c.sku) === normalizar(sku) && restantesCaja(c) > 0 && (!area || c.area_destino === area));
    }
    function abrirCajaEstupefaciente(entrada, s) {
        if (!puedeGestionarFarmacia(s)) return { ok: false, motivo: 'Su perfil no puede abrir una caja de estupefacientes.' };
        const catalogo = listarFarmacia();
        const lote = catalogo.find(p => p.lote_id === entrada.lote_id);
        if (!lote || lote.fraccion_cofepris !== 'I') return { ok: false, motivo: 'Seleccione un medicamento de Fracción I del almacén.' };
        const piezas = parseInt(lote.piezas_por_caja, 10) || 1;
        if (lote.stock < piezas) return { ok: false, motivo: 'No hay una caja completa en el almacén (' + piezas + ' ámpulas, lote ' + lote.lote + ').' };
        const folio = limpiarEspacios(entrada.folio_receta_especial).toUpperCase();
        if (!/^[A-Z0-9][A-Z0-9-]{2,29}$/.test(folio)) return { ok: false, motivo: 'Escriba el folio o código de barras de la receta física especial.' };
        const area = String(entrada.area_destino || '').trim();
        if (!AREAS_CAJA.some(a => a.codigo === area)) return { ok: false, motivo: 'Seleccione el área de resguardo: Quirófano, Hospitalización u Observación.' };
        const responsable = USUARIOS[entrada.responsable_id] || null;
        if (!responsable || responsable.rol !== 'medico') return { ok: false, motivo: 'Seleccione al médico o responsable sanitario que emitió la receta especial.' };
        const enf = USUARIOS[entrada.enfermera_id] || null;
        if (!enf || enf.activo === false || (ENFERMERIAS.indexOf(enf.rol) < 0 && enf.rol !== 'enf_farmacia')) return { ok: false, motivo: 'Seleccione a la enfermera que solicita y recibe la caja.' };
        const cajas = listarCajas();
        if (cajas.some(c => normalizar(c.folio_receta_especial) === normalizar(folio))) return { ok: false, motivo: 'Ese folio ya está registrado.' };
        const snap = JSON.stringify(catalogo);
        lote.stock -= piezas;
        if (!escribir(CLAVES.farmacia, catalogo)) return { ok: false, motivo: 'No se pudo descontar la caja del almacén.' };
        const quien = USUARIOS[s.usuario_id] || { id: s.usuario_id, nombre: s.nombre, cedula_profesional: '' };
        const caja = {
            caja_id: uid('CAJA'), sku: lote.sku, nombre: lote.nombre, lote_id: lote.lote_id, lote: lote.lote, caducidad: lote.caducidad,
            piezas_por_caja: piezas, ampulas_totales: piezas, ampulas_restantes: piezas, usadas: 0, stock_traspasado: true,
            folio_receta_especial: folio, area_destino: area,
            responsable_id: responsable.id, responsable_nombre: responsable.nombre, responsable_cedula: responsable.cedula_profesional || '',
            enfermera_id: enf.id, enfermera_nombre: enf.nombre,
            creada_en: new Date().toISOString(), usos: []
        };
        if (!anexarMovimientos([movimientoSalida(lote, piezas, quien, { paciente_nombre: 'Caja abierta ' + folio, area_paciente: 'Resguardo ' + nombreAreaCaja(area), medico_tratante: responsable.nombre })])) {
            escribir(CLAVES.farmacia, JSON.parse(snap));
            return { ok: false, motivo: 'No se pudo registrar el traspaso. La caja no se abrió.' };
        }
        cajas.unshift(caja);
        if (!escribir(CLAVES.cajasEstupefacientes, cajas)) {
            escribir(CLAVES.farmacia, JSON.parse(snap));
            return { ok: false, motivo: 'No se pudo abrir la caja.' };
        }
        return { ok: true, caja: caja };
    }
    function etiquetarAreaCajas() {
        const cajas = listarCajas();
        let cambio = false;
        cajas.forEach(c => {
            if (!c.area_destino) { c.area_destino = 'QUIROFANO'; cambio = true; }
            if (!c.caducidad) {
                const lote = listarFarmacia().find(p => p.lote_id === c.lote_id);
                if (lote) { c.caducidad = lote.caducidad; cambio = true; }
            }
        });
        if (cambio) escribir(CLAVES.cajasEstupefacientes, cajas);
    }
    function areaResguardoDeSesion(s) {
        if (!s) return null;
        if (s.rol === 'enf_quirofano') return 'QUIROFANO';
        if (s.rol === 'enf_hospital') return 'HOSPITALIZACION';
        if (s.rol === 'enf_triage') return 'OBSERVACION';
        if (s.rol === 'medico') {
            const u = USUARIOS[s.usuario_id];
            if (u && u.especialidad_codigo === 'ANESTESIOLOGIA') return 'QUIROFANO';
        }
        return null;
    }
    function areaResguardoDeTurno(turno) {
        const area = clasificarAreaFarmacia(turno);
        if (area === 'quirofano') return 'QUIROFANO';
        if (area === 'observacion') return 'OBSERVACION';
        if (area === 'hospital') return 'HOSPITALIZACION';
        return null;
    }
    function cajasDeArea(area, soloActivas) {
        return listarCajas().filter(c => (!area || c.area_destino === area) && (!soloActivas || restantesCaja(c) > 0));
    }
    function puedeDispensarEstupefaciente(s) {
        return !!s && (s.rol === 'admin' || s.rol === 'medico' || s.rol === 'administrador' || s.rol === 'enf_farmacia' || esEnfermeria(s.rol));
    }
    function dispensarAmpulas(entrada, s) {
        if (!puedeDispensarEstupefaciente(s)) return { ok: false, motivo: 'Su perfil no puede dispensar un estupefaciente.' };
        const op = entrada || {};
        const cant = parseInt(op.cantidad, 10);
        if (!Number.isInteger(cant) || cant < 1 || cant > 20) return { ok: false, motivo: 'Indique de 1 a 20 ámpulas.' };
        const t = obtenerTurno(op.turno_id);
        if (!t || !episodioAbiertoParaEstudios(t)) return { ok: false, motivo: 'Este paciente no admite el cargo.' };
        const catalogo = listarFarmacia();
        const cajas = listarCajas();
        const caja = cajas.find(c => c.caja_id === op.caja_id);
        if (!caja || restantesCaja(caja) < cant) return { ok: false, motivo: 'Seleccione una caja abierta con ámpulas suficientes.' };
        const aplicador = USUARIOS[op.aplicador_id] || USUARIOS[s.usuario_id];
        if (!aplicador || aplicador.activo === false) return { ok: false, motivo: 'Seleccione a la enfermera o al médico que aplicó el ámpula.' };
        const row = catalogo.find(p => p.lote_id === caja.lote_id);
        if (!row) return { ok: false, motivo: 'El lote de esa caja ya no está en el catálogo.' };
        if (!caja.stock_traspasado && row.stock < cant) return { ok: false, motivo: 'Esa caja ya no tiene piezas en el almacén.' };
        const snapCat = JSON.stringify(catalogo);
        const snapCajas = JSON.stringify(cajas);
        if (!caja.stock_traspasado) row.stock -= cant;
        if (caja.ampulas_restantes == null || caja.ampulas_restantes === '') caja.ampulas_restantes = (caja.piezas_por_caja || 0) - (caja.usadas || 0);
        if (!caja.ampulas_totales) caja.ampulas_totales = caja.piezas_por_caja || (caja.ampulas_restantes + (caja.usadas || 0));
        const usos = [];
        for (let n = 0; n < cant; n++) {
            const numero = (caja.usadas || 0) + n + 1;
            usos.push({
                uso_id: uid('AMP'), numero: numero, de: caja.ampulas_totales,
                turno_id: t.turno_id, paciente_nombre: t.paciente_nombre, fecha_hora: new Date().toISOString(),
                datos_postanestesicos: limpiarEspacios(op.datos || row.nombre), lote: caja.lote || row.lote, sku: caja.sku,
                caducidad: caja.caducidad || row.caducidad, folio_receta_especial: caja.folio_receta_especial, area_destino: caja.area_destino,
                aplicador_id: aplicador.id, aplicador_nombre: aplicador.nombre, cantidad: 1, caja_id: caja.caja_id
            });
        }
        caja.ampulas_restantes -= cant;
        caja.usadas = (caja.usadas || 0) + cant;
        caja.usos = (caja.usos || []).concat(usos);
        if ((!caja.stock_traspasado && !escribir(CLAVES.farmacia, catalogo)) || !escribir(CLAVES.cajasEstupefacientes, cajas)) {
            escribir(CLAVES.farmacia, JSON.parse(snapCat));
            escribir(CLAVES.cajasEstupefacientes, JSON.parse(snapCajas));
            return { ok: false, motivo: 'No se pudo descontar el ámpula de la caja.' };
        }
        const quien = { id: aplicador.id, nombre: aplicador.nombre };
        const cargo = cargoDesdeProducto(row, cant, quien, {});
        cargo.caja_id = caja.caja_id;
        cargo.folio_receta_especial = caja.folio_receta_especial;
        cargo.receta_individual = usos[0].numero + '/' + usos[0].de + (cant > 1 ? ' +' + (cant - 1) : '');
        const guardado = anexarCargosFarmacia(t.turno_id, [cargo]);
        if (!guardado) {
            escribir(CLAVES.farmacia, JSON.parse(snapCat));
            escribir(CLAVES.cajasEstupefacientes, JSON.parse(snapCajas));
            return { ok: false, motivo: 'No se pudo cargar el ámpula a la cuenta. La caja no se modificó.' };
        }
        if (!caja.stock_traspasado && !anexarMovimientos([movimientoSalida(row, cant, quien, Object.assign({}, fichaDestinoKardex(t), {
            folio_receta: caja.folio_receta_especial,
            tipo_respaldo: 'Receta Especial Fracción I',
            medico_prescriptor: caja.responsable_nombre || '',
            cedula_prescriptor: caja.responsable_cedula || '',
            estatus_receta: 'Retenida'
        }))])) {
            escribir(CLAVES.farmacia, JSON.parse(snapCat));
            escribir(CLAVES.cajasEstupefacientes, JSON.parse(snapCajas));
            return { ok: false, motivo: 'No se pudo registrar la salida. La caja no se modificó.' };
        }
        return { ok: true, uso: usos[0], usos: usos, caja: caja, producto: row, area: caja.area_destino, total: guardado.total, cargo: cargo };
    }
    function usarAmpulaDesdeNota(turnoId, sku, s, datosTexto, areaForzada, cajaId) {
        if (!cajaId) return { ok: false, motivo: 'Seleccione la caja abierta de la cual se tomó el ámpula.' };
        const caja = listarCajas().find(c => c.caja_id === cajaId);
        if (!caja) return { ok: false, motivo: 'Seleccione la caja abierta de la cual se tomó el ámpula.' };
        if (sku && normalizar(caja.sku) !== normalizar(sku)) return { ok: false, motivo: 'La caja seleccionada no corresponde a ese medicamento.' };
        if (areaForzada && caja.area_destino !== areaForzada) return { ok: false, motivo: 'Esa caja no está en resguardo de ' + nombreAreaCaja(areaForzada) + '.' };
        return dispensarAmpulas({ turno_id: turnoId, caja_id: cajaId, cantidad: 1, aplicador_id: s && s.usuario_id, datos: datosTexto }, s);
    }
    function confirmarCarritoFarmacia(entrada, s) {
        if (!puedeGestionarFarmacia(s)) return { ok: false, motivo: 'Su perfil no puede cargar a la cuenta.' };
        const t = obtenerTurno(entrada.turno_id);
        if (!t) return { ok: false, motivo: 'No se encontró al paciente.' };
        if (ESTATUS_EN_FILA.indexOf(t.estatus) < 0 && t.estatus !== ESTATUS.INTERNADO && t.estatus !== ESTATUS.INTERNADO_EN_PROCESO) return { ok: false, motivo: 'Ese paciente ya no está activo.' };
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
            if (lin.estudio_id || (lin.servicio && !lin.lote_id)) {
                const est = estudioPorId(lin.estudio_id) || estudioPorCodigo(lin.sku);
                if (!est) return { ok: false, motivo: 'Un estudio del carrito ya no está en el catálogo.' };
                const cantEst = parseInt(lin.cantidad, 10);
                if (!Number.isInteger(cantEst) || cantEst < 1 || cantEst > 99) return { ok: false, motivo: 'Cantidad inválida de ' + est.nombre + '.' };
                cargos.push(cargoDesdeEstudio(est, cantEst, quien, lin));
                continue;
            }
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
                return { ok: false, motivo: '🔒 Estupefaciente Fracción I: No se puede cargar una caja ni piezas sueltas directo del almacén. Debe abrirse primero una Caja en la pestaña Estupefacientes Fracción I con los datos de la Receta Especial, y surtirse por ámpula desde las Cajas Abiertas.' };
            }
            if (FRACCIONES_RECETA.indexOf(prod.fraccion_cofepris) >= 0) {
                if (!limpiarEspacios(lin.folio_receta) || limpiarEspacios(lin.folio_receta).length < 3) return { ok: false, motivo: 'Indique el folio de receta de ' + prod.nombre + ' (sistema, recetario físico u hoja de indicaciones).' };
                if (!lin.medico_prescriptor_id && inferirTipoRespaldo(lin.folio_receta, prod.fraccion_cofepris) !== 'Indicaciones Hospitalarias (IND)') return { ok: false, motivo: 'Indique el médico prescriptor de ' + prod.nombre + '.' };
            }
            const tope = pendienteFolioSku(lin.folio_receta, prod.sku);
            if (tope !== null) {
                const yaEnCarrito = lineas.slice(0, k).reduce((s, previa) => {
                    const otro = catalogo.find(p => p.lote_id === previa.lote_id);
                    return otro && normalizar(otro.sku) === normalizar(prod.sku) && normalizar(previa.folio_receta) === normalizar(lin.folio_receta) ? s + (parseInt(previa.cantidad, 10) || 0) : s;
                }, 0);
                if (cant + yaEnCarrito > tope) {
                    const faltan = Math.max(0, tope - yaEnCarrito);
                    const folioTxt = limpiarEspacios(lin.folio_receta).toUpperCase();
                    return { ok: false, motivo: faltan ? ('De ' + folioTxt + ' solo faltan ' + faltan + ' piezas de ' + prod.nombre + '.') : (folioTxt + ' ya está completa para ' + prod.nombre + '.') };
                }
            }
            const previo = descuentos[prod.lote_id] || 0;
            if (!lin.servicio && prod.stock < previo + cant) return { ok: false, motivo: 'No hay stock suficiente de ' + prod.nombre + ' (lote ' + prod.lote + ').' };
            if (!lin.servicio) descuentos[prod.lote_id] = previo + cant;
            cargos.push(cargoDesdeProducto(prod, cant, quien, lin));
        }
        ajusteDescuentoPaquete(cargos).forEach(ajuste => {
            ajuste.cargado_por_id = quien.id;
            ajuste.cargado_por_nombre = quien.nombre;
            cargos.push(ajuste);
        });
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
        const destino = Object.assign({}, fichaDestinoKardex(t), { turno_id: t.turno_id });
        const movs = [];
        lineas.forEach(lin => {
            if (lin.servicio) return;
            const prod = catalogo.find(p => p.lote_id === lin.lote_id);
            if (prod) {
                const cantMov = parseInt(lin.cantidad, 10);
                const tipoRespaldo = lin.tipo_respaldo || inferirTipoRespaldo(lin.folio_receta, prod.fraccion_cofepris, lin.folio_receta_especial);
                const previas = lineas.slice(0, lineas.indexOf(lin)).reduce((s, previa) => {
                    const otro = catalogo.find(p => p.lote_id === previa.lote_id);
                    return otro && normalizar(otro.sku) === normalizar(prod.sku) && normalizar(previa.folio_receta) === normalizar(lin.folio_receta) ? s + (parseInt(previa.cantidad, 10) || 0) : s;
                }, 0);
                movs.push(movimientoSalida(prod, cantMov, quien, Object.assign({}, destino, {
                    folio_receta: lin.folio_receta || '',
                    tipo_respaldo: tipoRespaldo,
                    medico_prescriptor: lin.medico_prescriptor_nombre || '',
                    cedula_prescriptor: lin.cedula_prescriptor || cedulaDeUsuario(lin.medico_prescriptor_id),
                    estatus_receta: textoEstatusBitacora(tipoRespaldo, lin.folio_receta, prod.sku, previas + cantMov)
                })));
            }
        });
        if (movs.length && !anexarMovimientos(movs)) {
            escribir(CLAVES.farmacia, JSON.parse(snapCat));
            if (usos.length) escribir(CLAVES.cajasEstupefacientes, JSON.parse(snapCajas));
            if (snapTurnos === null) localStorage.removeItem(CLAVES.turnos); else localStorage.setItem(CLAVES.turnos, snapTurnos);
            if (snapInts === null) localStorage.removeItem(CLAVES.internamientos); else localStorage.setItem(CLAVES.internamientos, snapInts);
            if (snapHosp === null) localStorage.removeItem(CLAVES.hospitalizados); else localStorage.setItem(CLAVES.hospitalizados, snapHosp);
            return { ok: false, motivo: 'No se pudo registrar la bitácora. La cuenta y el inventario no se modificaron.' };
        }
        const porFolio = {};
        lineas.forEach(lin => {
            if (!lin.folio_receta || lin.servicio) return;
            const prod = catalogo.find(p => p.lote_id === lin.lote_id);
            if (!prod) return;
            const folio = limpiarEspacios(lin.folio_receta).toUpperCase();
            if (!porFolio[folio]) porFolio[folio] = [];
            porFolio[folio].push({ sku: prod.sku, cantidad: parseInt(lin.cantidad, 10) || 1, lote: prod.lote });
        });
        Object.keys(porFolio).forEach(folio => registrarSurtidoReceta(folio, porFolio[folio]));
        return { ok: true, cargos: cargos, total: guardado.total, recetas: recetas };
    }
    function listarMovimientosFarmacia() { return leer(CLAVES.movimientosFarmacia, []); }

    // ---------------------------------------------------------------- Fracción I pendientes
    function ampulasFraccionIPendientes(turnoId) {
        const out = [];
        listarCajas().forEach(c => (c.usos || []).forEach(u => {
            if (u.turno_id !== turnoId) return;
            const d = u.datos_postanestesicos;
            const completo = d && typeof d === 'object' && d.lote && d.dosis_administrada && d.merma != null;
            if (!completo) out.push({ uso_id: u.uso_id, caja_id: c.caja_id, nombre: c.nombre, lote: u.lote || c.lote || '', numero: u.numero, de: u.de, fecha_hora: u.fecha_hora });
        }));
        return out;
    }
    function justificarAmpulasFraccionI(turnoId, lista, s) {
        const cajas = listarCajas();
        let n = 0;
        cajas.forEach(c => (c.usos || []).forEach(u => {
            const j = (lista || []).find(x => x.uso_id === u.uso_id);
            if (!j || u.turno_id !== turnoId) return;
            u.datos_postanestesicos = Object.assign({}, typeof u.datos_postanestesicos === 'object' ? u.datos_postanestesicos : { texto: u.datos_postanestesicos || '' },
                { lote: limpiarEspacios(j.lote), dosis_administrada: limpiarEspacios(j.dosis_administrada), merma: limpiarEspacios(j.merma), justificado_por: s && s.usuario_id, justificado_en: new Date().toISOString() });
            n++;
        }));
        if (n) escribir(CLAVES.cajasEstupefacientes, cajas);
        return n;
    }
    // ---------------------------------------------------------------- Pre / Trans anestésico
    function guardarHojaAnestesia(campo, prefijo, turnoId, entrada, s) {
        const i = asegurarInternamiento(turnoId);
        const t = obtenerTurno(turnoId);
        if (!i || !t || t.estatus !== ESTATUS.INTERNADO) return { ok: false, motivo: 'El internamiento no está activo.' };
        if (!puedeNotaPostanestesica(s, i)) return { ok: false, motivo: 'Solo el anestesiólogo, el cirujano o Dirección pueden registrar esta hoja.' };
        const e = Object.assign({}, entrada || {});
        const lista = (i[campo] || []);
        const nota = Object.assign(e, { nota_id: uid(prefijo), folio: prefijo + '-' + pad3(lista.length + 1), fecha_hora: new Date().toISOString(), autor_id: s.usuario_id, autor_nombre: s.nombre });
        i[campo] = lista.concat([nota]);
        if (!guardarInternamiento(i)) return { ok: false, motivo: 'No se pudo guardar la hoja.' };
        return { ok: true, nota: nota, internamiento: obtenerInternamiento(i.internamiento_id) };
    }
    function guardarNotaPreanestesica(turnoId, entrada, s) {
        const e = entrada || {};
        if (contarLetrasTxt(String(e.valoracion || e.plan || '')) < 10) return { ok: false, errores: { valoracion: 'Escriba la valoración preanestésica (mínimo 10 letras).' }, motivo: 'Escriba la valoración preanestésica.' };
        return guardarHojaAnestesia('notas_preanestesicas', 'PRE', turnoId, e, s);
    }
    function guardarRegistroTransanestesico(turnoId, entrada, s) {
        return guardarHojaAnestesia('registros_transanestesicos', 'TRA', turnoId, entrada, s);
    }
    // ---------------------------------------------------------------- Secciones editables (ambulatorio Qx)
    const SECCIONES_QX_AMBULATORIO = ['historia_clinica', 'hoja_postoperatoria', 'hoja_quirurgica', 'checklist_cirugia_segura', 'patologia', 'egreso'];
    function puedeEditarSeccion(s, i, seccion) {
        if (!s || !i) return false;
        if (s.rol === 'admin') return true;
        if (s.rol !== 'medico') return false;
        if (relacionMedico(i, obtenerTurno(i.turno_id), s) === 'tratante') return true;
        if (i.modalidad === MODALIDAD_AMBULATORIO_QX && SECCIONES_QX_AMBULATORIO.indexOf(seccion) >= 0) {
            return esCirujanoDelInternamiento(i, s) || esAnestesiologoDelInternamiento(i, s);
        }
        return false;
    }
    // ---------------------------------------------------------------- Pase automático a quirófano
    let _sincQx = false;
    function sincronizarPaseAutomaticoQuirofano(ahora) {
        if (_sincQx) return 0;
        _sincQx = true;
        let n = 0;
        try {
            const lista = leer(CLAVES.internamientos, []);
            lista.forEach(i => {
                if (!i || i.estatus !== 'activo' || i.modalidad === MODALIDAD_AMBULATORIO_QX) return;
                const t = obtenerTurno(i.turno_id);
                if (!t || t.estatus !== ESTATUS.INTERNADO || ubicacionDe(i) !== UBICACION_QX.PISO) return;
                const c = cirugiaRawDePaciente(t, ahora);
                if (!c) return;
                const min = minutosParaInicioCirugia(c, ahora);
                if (min === null || min > 0 || min < -240) return;
                i.cama_origen_piso = i.cama_codigo || i.cama || i.cama_origen_piso || null;
                i.cama = null; i.cama_codigo = null;
                i.ubicacion = UBICACION_QX.EN_TRANSITO_QUIROFANO;
                i.area_destino = 'Quirófano';
                i.cirugia_id = c.cirugia_id;
                i.traslado_qx_en = new Date().toISOString();
                i.traslado_automatico = true;
                if (guardarInternamiento(i)) { actualizarTurno(t.turno_id, { area_destino: 'Quirófano', destino: 'Quirofano' }); n++; }
            });
        } catch (err) { /* no interrumpe el listado */ }
        _sincQx = false;
        return n;
    }
    function listarCirugiasSincronizadas() { sincronizarPaseAutomaticoQuirofano(); return listarCirugias(); }
    function listarInternamientosSincronizados() { sincronizarPaseAutomaticoQuirofano(); return listarInternamientos(); }
    // ---------------------------------------------------------------- Hoja de Enfermería
    const TURNOS_ENFERMERIA = ['MATUTINO', 'VESPERTINO', 'NOCTURNO'];
    function obtenerHojaEnfermeria(turnoId) {
        const todas = leer(CLAVES.hojasEnfermeria, {}) || {};
        const h = todas[turnoId] || { turno_id: turnoId, kardex: [], signos: [], balance: { ingresos: [], egresos: [] } };
        const sum = arr => (arr || []).reduce((a, x) => a + (Number(x.ml) || 0), 0);
        h.balance = h.balance || { ingresos: [], egresos: [] };
        h.balance.total_ingresos = sum(h.balance.ingresos);
        h.balance.total_egresos = sum(h.balance.egresos);
        h.balance.balance = h.balance.total_ingresos - h.balance.total_egresos;
        return h;
    }
    function guardarHojaEnfermeria(turnoId, datos, s) {
        if (!s || ['admin', 'enf_hospital', 'enf_quirofano', 'enf_triage', 'medico'].indexOf(s.rol) < 0) return { ok: false, motivo: 'Su perfil no puede registrar la Hoja de Enfermería.' };
        if (!obtenerTurno(turnoId)) return { ok: false, motivo: 'No se encontró el episodio.' };
        const d = datos || {};
        const h = obtenerHojaEnfermeria(turnoId);
        const sello = { usuario_id: s.usuario_id, usuario_nombre: s.nombre, registrado_en: new Date().toISOString() };
        (d.kardex || []).forEach(k => { if (limpiarEspacios(k.medicamento)) h.kardex.push(Object.assign({ id: uid('KDX'), hora: k.hora || '' }, k, sello)); });
        (d.signos || []).forEach(x => {
            const turno = String(x.turno || '').toUpperCase();
            if (TURNOS_ENFERMERIA.indexOf(turno) < 0) return;
            h.signos.push(Object.assign({ id: uid('SVE') }, x, { turno: turno, glucosa_mg_dl: x.glucosa_mg_dl === '' || x.glucosa_mg_dl == null ? null : Number(x.glucosa_mg_dl) }, sello));
        });
        const bal = d.balance || {};
        ['ingresos', 'egresos'].forEach(k => (bal[k] || []).forEach(x => { if (Number(x.ml) > 0) h.balance[k].push(Object.assign({ id: uid('BH') }, x, { ml: Number(x.ml) }, sello)); }));
        if (d.observaciones != null) h.observaciones = String(d.observaciones);
        const todas = leer(CLAVES.hojasEnfermeria, {}) || {};
        delete h.balance.total_ingresos; delete h.balance.total_egresos; delete h.balance.balance;
        todas[turnoId] = h;
        if (!escribir(CLAVES.hojasEnfermeria, todas)) return { ok: false, motivo: 'No se pudo guardar la Hoja de Enfermería.' };
        return { ok: true, hoja: obtenerHojaEnfermeria(turnoId) };
    }
    // ---------------------------------------------------------------- Farmacia: devolución y baja
    function puedeDevolverFarmacia(s) { return !!s && (s.rol === 'admin' || s.rol === 'administrador' || s.rol === 'enf_farmacia'); }
    function devolverSalidaFarmacia(movimientoId, op, s) {
        if (!puedeDevolverFarmacia(s)) return { ok: false, motivo: 'Solo Dirección, Administración o Farmacia pueden devolver un surtido.' };
        const o = op || {};
        const motivo = limpiarEspacios(o.motivo);
        if (motivo.length < 3) return { ok: false, motivo: 'Escriba el motivo de la devolución.' };
        const movs = listarMovimientosFarmacia();
        const m = movs.find(x => x.movimiento_id === movimientoId && x.tipo === 'SALIDA');
        if (!m) return { ok: false, motivo: 'No se encontró la salida.' };
        const devuelto = movs.filter(x => x.tipo_movimiento === 'DEVOLUCION' && x.movimiento_origen_id === movimientoId).reduce((a, x) => a + (Number(x.cantidad_piezas) || 0), 0);
        const disponible = (Number(m.cantidad_piezas) || 0) - devuelto;
        const cant = o.cantidad == null || o.cantidad === '' ? disponible : parseInt(o.cantidad, 10);
        if (!Number.isInteger(cant) || cant < 1 || cant > disponible) return { ok: false, motivo: 'Cantidad a devolver inválida (máximo ' + disponible + ').' };
        const catalogo = listarFarmacia();
        const lote = catalogo.find(p => (m.lote_id && p.lote_id === m.lote_id) || (normalizar(p.sku) === normalizar(m.sku) && p.lote === m.lote));
        if (!lote) return { ok: false, motivo: 'El lote original ya no existe en el inventario.' };
        lote.stock = (Number(lote.stock) || 0) + cant;
        if (!escribir(CLAVES.farmacia, catalogo)) return { ok: false, motivo: 'No se pudo actualizar el inventario.' };
        // Cuenta del paciente
        let cuenta = null;
        const turnoId = m.turno_id || (listarTurnos().filter(t => t.paciente_id && t.paciente_id === m.paciente_id && t.estatus !== ESTATUS.CERRADO_HISTORICO).pop() || {}).turno_id;
        const t = turnoId && obtenerTurno(turnoId);
        if (t && t.estatus !== ESTATUS.CERRADO_HISTORICO) {
            const i = internamientoDeTurno(turnoId);
            const enI = i && (i.cargos || []).some(c => c.lote_id === lote.lote_id);
            const lista = enI ? i.cargos : (t.cargos || []);
            let resta = cant;
            for (let k = lista.length - 1; k >= 0 && resta > 0; k--) {
                const c = lista[k];
                if (c.lote_id !== lote.lote_id) continue;
                const q = Number(c.cantidad || 1);
                if (q <= resta) { lista.splice(k, 1); resta -= q; }
                else { c.cantidad = q - resta; c.subtotal = redondearMoneda(Number(c.precio_unitario) * c.cantidad); resta = 0; }
            }
            if (enI) guardarInternamiento(i); else actualizarTurno(turnoId, { cargos: lista });
            cuenta = recalcularCuentaTurno(turnoId);
        }
        const dev = Object.assign({}, m, identidadMovimiento(s), {
            movimiento_id: uid('MOV'), tipo: 'DEVOLUCION', tipo_movimiento: 'DEVOLUCION', movimiento_origen_id: movimientoId,
            fecha_hora: new Date().toISOString(), cantidad_piezas: cant, saldo_lote: lote.stock, motivo: motivo
        });
        anexarMovimientos([dev]);
        escribir(CLAVES.salidasFarmacia, listarSalidasFarmacia().concat([{
            salida_id: uid('DEV'), tipo: 'devolucion', tipo_movimiento: 'DEVOLUCION', movimiento_origen_id: movimientoId, lote_id: lote.lote_id, sku: lote.sku,
            nombre: denominacionProducto(lote), lote: lote.lote, caducidad: lote.caducidad, cantidad: cant, motivo: motivo, saldo_lote: lote.stock,
            fecha_hora: dev.fecha_hora, operador_id: s.usuario_id, operador_nombre: s.nombre, turno_id: turnoId || ''
        }]));
        return { ok: true, movimiento: dev, saldo_lote: lote.stock, total_cuenta: cuenta };
    }
    const MOTIVOS_BAJA_FARMACIA = ['CADUCIDAD', 'MERMA_ROTURA', 'OTRO'];
    function darBajaInsumoFarmacia(loteId, op, s) {
        if (!puedeDevolverFarmacia(s)) return { ok: false, motivo: 'Solo Dirección, Administración o Farmacia pueden dar de baja insumos.' };
        const o = op || {};
        const motivo = String(o.motivo || '').toUpperCase();
        if (MOTIVOS_BAJA_FARMACIA.indexOf(motivo) < 0) return { ok: false, motivo: 'Seleccione el motivo: Caducidad, Merma/Rotura u Otro.' };
        const catalogo = listarFarmacia();
        const lote = catalogo.find(p => p.lote_id === loteId);
        if (!lote) return { ok: false, motivo: 'No se encontró el lote.' };
        const cant = parseInt(o.cantidad, 10);
        if (!Number.isInteger(cant) || cant < 1 || cant > Number(lote.stock)) return { ok: false, motivo: 'Cantidad inválida (existencia: ' + lote.stock + ').' };
        lote.stock = Number(lote.stock) - cant;
        if (!escribir(CLAVES.farmacia, catalogo)) return { ok: false, motivo: 'No se pudo actualizar el inventario.' };
        const detalle = limpiarEspacios(o.detalle || o.observaciones || '');
        const ahora = new Date().toISOString();
        const registro = {
            salida_id: uid('BAJA'), tipo: 'baja', tipo_movimiento: 'BAJA_' + motivo, motivo: motivo, detalle: detalle,
            lote_id: lote.lote_id, sku: lote.sku, nombre: denominacionProducto(lote), lote: lote.lote, caducidad: lote.caducidad,
            cantidad: cant, saldo_lote: lote.stock, fecha_hora: ahora, operador_id: s.usuario_id, operador_nombre: s.nombre
        };
        escribir(CLAVES.salidasFarmacia, listarSalidasFarmacia().concat([registro]));
        const mov = Object.assign(movimientoSalida(lote, cant, s, { area_paciente: 'BAJA POR ' + motivo.replace('_', ' / ') }), { tipo: 'BAJA', tipo_movimiento: 'BAJA_' + motivo, motivo: motivo + (detalle ? ' · ' + detalle : ''), saldo_lote: lote.stock });
        anexarMovimientos([mov]);
        return { ok: true, registro: registro, saldo_lote: lote.stock };
    }

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
            fraccion_cofepris: valores.fraccion_cofepris || 'NA', clasificacion_aware: valores.clasificacion_aware || '',
            categoria: valores.categoria || 'MEDICAMENTO', lote: valores.lote, caducidad: valores.caducidad,
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
            movimiento_id: uid('MOV'), tipo: 'SALIDA', fecha_hora: new Date().toISOString(), lote_id: prod.lote_id || '', turno_id: d.turno_id || '', saldo_lote: Number(prod.stock) || 0,
            sku: prod.sku, principio_activo: prod.nombre, nombre_comercial: prod.nombre_comercial || '',
            laboratorio: prod.laboratorio || '', proveedor: prod.proveedor || '', numero_factura: prod.numero_factura || '',
            forma_farmaceutica: prod.forma_farmaceutica || '', concentracion: prod.concentracion || '',
            fraccion_cofepris: prod.fraccion_cofepris || 'NA', clasificacion_aware: prod.clasificacion_aware || '',
            categoria: prod.categoria || '', lote: prod.lote, caducidad: prod.caducidad,
            cajas_ingresadas: '', piezas_por_caja: prod.piezas_por_caja || '', total_piezas: '', cantidad_piezas: cantidad,
            precio_unitario: prod.precio_unitario, aplica_iva: !!prod.aplica_iva,
            paciente_id: d.paciente_id || '', paciente_nombre: d.paciente_nombre || '',
            paciente_edad: d.paciente_edad === 0 ? 0 : (d.paciente_edad || ''),
            paciente_telefono: d.paciente_telefono || '',
            paciente_direccion: d.paciente_direccion || '',
            area_paciente: d.area_paciente || '', cama: d.cama || '', medico_tratante: d.medico_tratante || '',
            folio_receta: d.folio_receta ? limpiarEspacios(d.folio_receta).toUpperCase() : '',
            tipo_respaldo: d.tipo_respaldo || '',
            medico_prescriptor: d.medico_prescriptor || '',
            cedula_prescriptor: d.cedula_prescriptor || '',
            estatus_receta: d.estatus_receta || ''
        }, idn);
    }
    function fechaLocalDeIso(iso) {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function productoDeMovimiento(m) {
        if (!m) return null;
        return listarFarmacia().find(p => normalizar(p.sku) === normalizar(m.sku) && normalizar(p.lote) === normalizar(m.lote))
            || listarFarmacia().find(p => normalizar(p.sku) === normalizar(m.sku))
            || null;
    }
    function esMedicamentoMovimiento(m) {
        if (!m) return false;
        if (SKUS_FUERA_DE_ALMACEN.indexOf(String(m.sku || '').toUpperCase()) >= 0) return false;
        if (m.forma_farmaceutica === 'ESTUDIO') return false;
        if (m.categoria && CATEGORIAS_FISICAS.indexOf(m.categoria) < 0) return false;
        if (m.categoria === 'MEDICAMENTO') return true;
        if (m.categoria && m.categoria !== 'MEDICAMENTO') return false;
        if (estudioPorCodigo(m.sku)) return false;
        const prod = productoDeMovimiento(m);
        if (prod) return prod.categoria === 'MEDICAMENTO';
        return ['I', 'II', 'III', 'IV', 'IV_ANTIBIOTICO', 'V', 'VI'].indexOf(m.fraccion_cofepris) >= 0;
    }
    function presentacionMovimiento(m) {
        const forma = nombreFormaFarmaceutica(m.forma_farmaceutica);
        return [m.principio_activo, m.concentracion, forma].filter(Boolean).join(' · ');
    }
    function awareDeMovimiento(m) {
        if (m.clasificacion_aware) return m.clasificacion_aware;
        const prod = productoDeMovimiento(m);
        return (prod && prod.clasificacion_aware) || '';
    }
    function coincideClasificacionBitacora(m, codigo) {
        if (!codigo) return true;
        const fr = m.fraccion_cofepris;
        if (codigo === 'CONTROLADOS') return fr === 'I' || fr === 'II' || fr === 'III';
        if (codigo === 'ANTIBIOTICOS') return fr === 'IV_ANTIBIOTICO';
        if (codigo === 'ACCESO' || codigo === 'VIGILANCIA' || codigo === 'RESERVA') return awareDeMovimiento(m) === codigo;
        return true;
    }
    function movimientosMedicamento(s) {
        if (!s || !permisoAccionDe(s.usuario_id, 'ver_bitacora_farmacia')) return [];
        return listarMovimientosFarmacia().filter(esMedicamentoMovimiento);
    }
    function filtrarMovimientosFarmacia(s, filtros) {
        if (!s || !permisoAccionDe(s.usuario_id, 'ver_bitacora_farmacia')) return [];
        const f = filtros || {};
        const tipo = f.tipo === 'ENTRADA' || f.tipo === 'SALIDA' ? f.tipo : '';
        const persona = String(f.persona || '').trim();
        const med = normalizar(f.medicamento || '');
        const lote = normalizar(f.lote || '');
        return movimientosMedicamento(s).filter(m => {
            if (tipo && m.tipo !== tipo) return false;
            const dia = fechaLocalDeIso(m.fecha_hora);
            if (f.desde && dia < f.desde) return false;
            if (f.hasta && dia > f.hasta) return false;
            if (persona && m.usuario_id !== persona && normalizar(m.nombre).indexOf(normalizar(persona)) < 0) return false;
            if (med) {
                const pres = normalizar(presentacionMovimiento(m));
                if (pres !== med && pres.indexOf(med) < 0 && normalizar(m.principio_activo).indexOf(med) < 0 && normalizar(m.sku).indexOf(med) < 0) return false;
            }
            if (lote && normalizar(m.lote) !== lote) return false;
            if (!coincideClasificacionBitacora(m, f.clasificacion)) return false;
            return true;
        });
    }
    function personasBitacora(s) {
        const cuenta = {};
        movimientosMedicamento(s).forEach(m => {
            const id = m.usuario_id || m.nombre || '';
            if (!id) return;
            if (!cuenta[id]) cuenta[id] = { id: m.usuario_id || '', nombre: m.nombre || id, n: 0 };
            cuenta[id].n += 1;
        });
        return Object.keys(cuenta).map(k => cuenta[k]).sort((a, b) => b.n - a.n || a.nombre.localeCompare(b.nombre, 'es'));
    }
    function presentacionesBitacora(s) {
        const vistos = {};
        movimientosMedicamento(s).forEach(m => {
            const texto = presentacionMovimiento(m);
            if (!texto || vistos[texto]) return;
            vistos[texto] = true;
        });
        listarFarmacia().forEach(p => {
            if (p.categoria !== 'MEDICAMENTO') return;
            const texto = [p.nombre, p.concentracion, nombreFormaFarmaceutica(p.forma_farmaceutica)].filter(Boolean).join(' · ');
            if (texto) vistos[texto] = true;
        });
        return Object.keys(vistos).sort((a, b) => a.localeCompare(b, 'es'));
    }
    function lotesDePresentacion(s, presentacion) {
        const n = normalizar(presentacion);
        if (!n) return [];
        const vistos = {};
        movimientosMedicamento(s).forEach(m => {
            const pres = normalizar(presentacionMovimiento(m));
            if (pres !== n && pres.indexOf(n) < 0) return;
            if (m.lote) vistos[m.lote] = true;
        });
        listarFarmacia().forEach(p => {
            if (p.categoria !== 'MEDICAMENTO') return;
            const texto = normalizar([p.nombre, p.concentracion, nombreFormaFarmaceutica(p.forma_farmaceutica)].filter(Boolean).join(' · '));
            if (texto === n || texto.indexOf(n) >= 0) vistos[p.lote] = true;
        });
        return Object.keys(vistos).sort((a, b) => a.localeCompare(b, 'es'));
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
        const filas = filtrarMovimientosFarmacia(s, f);
        const encabezado = ['Tipo', 'Fecha y hora', 'Usuario', 'Nombre', 'Cédula', 'SKU', 'Principio activo', 'Presentación', 'Nombre comercial', 'Laboratorio', 'Proveedor', 'Número de factura', 'Forma farmacéutica', 'Concentración', 'Fracción COFEPRIS', 'Clasificación AWaRe', 'Lote', 'Caducidad', 'Cajas ingresadas', 'Piezas por caja', 'Total de piezas ingresadas', 'Cantidad de piezas retiradas', 'Precio unitario', 'Grava IVA', 'Paciente', 'Edad', 'Área', 'Cama', 'Médico tratante', 'Teléfono / Celular Paciente', 'Dirección Paciente', 'Tipo de Respaldo Médico', 'Folio de Receta / Indicación', 'Médico Prescriptor', 'Cédula del Médico Prescriptor', 'Estatus de Receta', 'Saldo / Existencia Lote', 'Motivo'];
        const lineas = filas.slice().sort((a, b) => String(a.fecha_hora).localeCompare(String(b.fecha_hora))).map(m => {
            const aware = awareDeMovimiento(m);
            const celdas = [
                m.tipo, m.fecha_hora, m.usuario_id, m.nombre, m.cedula_profesional, m.sku, m.principio_activo, presentacionMovimiento(m), m.nombre_comercial,
                m.laboratorio, m.proveedor, m.numero_factura, nombreFormaFarmaceutica(m.forma_farmaceutica), m.concentracion,
                nombreFraccionCofepris(m.fraccion_cofepris), aware ? (CLASIFICACION_AWARE.find(a => a.codigo === aware) || {}).nombre || aware : '',
                m.lote, m.caducidad, m.cajas_ingresadas, m.piezas_por_caja, m.total_piezas,
                m.cantidad_piezas, m.precio_unitario, m.aplica_iva ? 'Sí' : 'No', m.paciente_nombre, m.paciente_edad, m.area_paciente, m.cama, m.medico_tratante,
                m.paciente_telefono || '', m.paciente_direccion || '',
                m.tipo_respaldo || '', m.folio_receta || '', m.medico_prescriptor || '', m.cedula_prescriptor || '', m.estatus_receta || '', m.saldo_lote == null ? '' : m.saldo_lote, m.motivo || ''
            ];
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
        if (!s) return [];
        const rol = s.rol || (USUARIOS[s.usuario_id] || {}).rol;
        const veTodas = rol === 'admin' || rol === 'administrador' || rol === 'enf_farmacia' || permisoAccionDe(s.usuario_id, 'farmacia_estupefacientes');
        if (!veTodas) return [];
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

    const ALIAS_MEDICAMENTO = [
        { aguja: 'ceftria', raiz: 'ceftriaxona' },
        { aguja: 'dexa', raiz: 'dexametasona' },
        { aguja: 'mida', raiz: 'midazolam' },
        { aguja: 'fenta', raiz: 'fentanilo' }
    ];
    function palabraEnTexto(texto, aguja) {
        if (!aguja) return false;
        const segura = aguja.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp('(^|[^a-z0-9])' + segura + '([^a-z0-9]|$)').test(texto);
    }
    function coincidenciaMedicamento(textoNorm, producto) {
        const campos = [producto.nombre, producto.nombre_comercial].filter(Boolean);
        const blob = normalizar(campos.join(' '));
        const tokens = [];
        campos.forEach(c => normalizar(c).split(/[^a-z0-9]+/).forEach(w => { if (w.length >= 5) tokens.push(w); }));
        const token = tokens.find(w => textoNorm.indexOf(w) >= 0);
        if (token) return token;
        const alias = ALIAS_MEDICAMENTO.find(a => blob.indexOf(a.raiz) >= 0 && palabraEnTexto(textoNorm, a.aguja));
        return alias ? alias.aguja : '';
    }
    function alertasCofeprisEnTexto(texto) {
        const n = normalizar(texto);
        if (!n) return [];
        const vistos = {}, out = [];
        listarFarmacia().forEach(p => {
            if (vistos[p.sku]) return;
            if (p.fraccion_cofepris !== 'I' && FRACCIONES_RECETA.indexOf(p.fraccion_cofepris) < 0) return;
            const token = coincidenciaMedicamento(n, p);
            if (!token) return;
            vistos[p.sku] = true;
            const hoy = hoyLocal();
            const vigente = listarFarmacia().filter(x => normalizar(x.sku) === normalizar(p.sku) && x.stock > 0 && String(x.caducidad) >= hoy).sort((a, b) => String(a.caducidad).localeCompare(String(b.caducidad)))[0] || p;
            const linea = String(texto).split(/\n/).map(l => l.trim()).find(l => {
                const ln = normalizar(l);
                return ln.indexOf(token) >= 0 || palabraEnTexto(ln, token);
            }) || vigente.nombre;
            out.push(fichaNormativa(vigente, linea));
        });
        return out;
    }
    function listarRecetasFoliadas() { return leer(CLAVES.recetasFoliadas, []); }
    function listarRecetas() { return leer(CLAVES.recetas, []); }
    function recetaPorFolio(folio) {
        const f = normalizar(folio);
        if (!f) return null;
        return listarRecetas().find(r => normalizar(r.folio) === f || normalizar(r.folio_externo) === f) || null;
    }
    function recetasDeTurno(turnoId) { return listarRecetas().filter(r => r.turno_id === turnoId); }
    function recetasDePaciente(pacienteId) { return listarRecetas().filter(r => r.paciente_id === pacienteId); }
    function catalogoMedicamentosUnicos() {
        const vistos = {};
        const out = [];
        listarFarmacia().forEach(p => {
            if (!p || p.categoria === 'INSUMO' || vistos[p.sku]) return;
            vistos[p.sku] = true;
            out.push(productoPorSku(p.sku) || p);
        });
        return out;
    }
    function buscarMedicamentosReceta(texto) {
        const n = normalizar(texto);
        if (n.length < 2) return [];
        return catalogoMedicamentosUnicos().filter(p => normalizar([p.sku, p.nombre, p.nombre_comercial].filter(Boolean).join(' ')).indexOf(n) >= 0).slice(0, 8);
    }
    const FRACCIONES_HOJA = ['IV', 'V', 'VI', 'IV_ANTIBIOTICO'];
    function tokenPropioEnTexto(textoNorm, prod) {
        const campos = [prod.nombre, prod.nombre_comercial].filter(Boolean);
        const tokens = [];
        campos.forEach(c => normalizar(c).split(/[^a-z0-9]+/).forEach(w => { if (w.length >= 5) tokens.push(w); }));
        const propios = tokens.filter(w => textoNorm.indexOf(w) >= 0).sort((a, b) => b.length - a.length);
        const alias = ALIAS_MEDICAMENTO.find(a => normalizar(campos.join(' ')).indexOf(a.raiz) >= 0 && palabraEnTexto(textoNorm, a.aguja));
        if (!propios.length) return alias ? alias.aguja : '';
        const mejor = propios[0];
        const compartido = catalogoMedicamentosUnicos().some(p => p.sku !== prod.sku && normalizar([p.nombre, p.nombre_comercial].filter(Boolean).join(' ')).indexOf(mejor) >= 0);
        if (compartido && propios.length === 1 && !alias) return '';
        return alias && alias.aguja.length > mejor.length ? alias.aguja : mejor;
    }
    function medicamentosDetectadosEnTexto(texto) {
        const crudo = String(texto || '');
        const n = normalizar(crudo);
        if (!n) return [];
        const vistos = {};
        const out = [];
        catalogoMedicamentosUnicos().forEach(prod => {
            if (!prod.fraccion_cofepris || prod.fraccion_cofepris === 'NA') return;
            const golpe = tokenPropioEnTexto(n, prod);
            if (!golpe || vistos[prod.sku]) return;
            vistos[prod.sku] = true;
            const pos = Math.max(0, n.indexOf(golpe));
            const corte = crudo.slice(Math.max(0, pos - 12), Math.min(crudo.length, pos + 90)).replace(/\s+/g, ' ').trim();
            out.push({
                sku: prod.sku, nombre: prod.nombre, concentracion: prod.concentracion || '',
                forma_farmaceutica: prod.forma_farmaceutica || '', fraccion_cofepris: prod.fraccion_cofepris || 'VI',
                clasificacion_aware: prod.clasificacion_aware || null, dosis_indicacion: corte,
                cubierta_por_hoja: FRACCIONES_HOJA.indexOf(prod.fraccion_cofepris) >= 0,
                requiere_receta_retenida: prod.fraccion_cofepris === 'I' || prod.fraccion_cofepris === 'II' || prod.fraccion_cofepris === 'III'
            });
        });
        return out;
    }
    function anotarCoberturaIndicacion(hoja) {
        if (!hoja) return hoja;
        const detectados = medicamentosDetectadosEnTexto([hoja.medicamentos, hoja.soluciones_parenterales].filter(Boolean).join('\n'));
        hoja.medicamentos_vinculados = detectados.map(d => ({
            sku: d.sku, nombre: d.nombre, fraccion_cofepris: d.fraccion_cofepris,
            folio_hoja: d.cubierta_por_hoja ? hoja.folio : null,
            requiere_receta_retenida: d.requiere_receta_retenida
        }));
        return hoja;
    }
    function reservarFolioReceta() {
        const actual = parseInt(localStorage.getItem(CLAVES.folioRecetaSeq) || '0', 10) || 0;
        const siguiente = actual + 1;
        localStorage.setItem(CLAVES.folioRecetaSeq, String(siguiente));
        return 'SB-REC-' + String(siguiente).padStart(5, '0');
    }
    function devolverFolioReceta(folio) {
        const n = parseInt(String(folio || '').replace(/\D/g, ''), 10);
        const actual = parseInt(localStorage.getItem(CLAVES.folioRecetaSeq) || '0', 10) || 0;
        if (n && n === actual) localStorage.setItem(CLAVES.folioRecetaSeq, String(n - 1));
    }
    function fichaPacienteReceta(pacienteId, turno) {
        const p = buscarPacientePorId(pacienteId) || {};
        const i = turno ? internamientoDeTurno(turno.turno_id) : null;
        const sv = (turno && turno.signos_vitales) || {};
        return {
            paciente_id: pacienteId || null,
            paciente_nombre: p.nombre_completo || (turno && turno.paciente_nombre) || '',
            paciente_edad: p.fecha_nacimiento ? calcularEdad(p.fecha_nacimiento) : null,
            paciente_fecha_nacimiento: p.fecha_nacimiento || (turno && turno.fecha_nacimiento) || '',
            paciente_telefono: p.telefono || '',
            paciente_direccion: p.direccion || '',
            paciente_peso: sv.peso_kg != null && sv.peso_kg !== '' ? sv.peso_kg : '',
            paciente_talla: sv.talla_m != null && sv.talla_m !== '' ? sv.talla_m : '',
            paciente_alergias: (i && i.alergias) || (turno && alergiasDeBorrador(turno.turno_id)) || ''
        };
    }
    function itemRecetaDesdeProducto(prod, entrada) {
        const cantidad = parseInt(entrada && entrada.cantidad, 10);
        return {
            sku: prod.sku,
            nombre: prod.nombre,
            concentracion: prod.concentracion || '',
            forma_farmaceutica: prod.forma_farmaceutica || '',
            fraccion_cofepris: prod.fraccion_cofepris || 'VI',
            clasificacion_aware: prod.clasificacion_aware || null,
            dosis_indicacion: limpiarEspacios((entrada && (entrada.dosis_indicacion || entrada.dosis)) || ''),
            cantidad_prescrita: cantidad >= 1 && cantidad <= 99 ? cantidad : 1,
            cantidad_surtida: 0,
            lotes_surtidos: []
        };
    }
    function estatusSurtidoDe(items) {
        const lista = items || [];
        const medibles = lista.filter(i => (parseInt(i.cantidad_prescrita, 10) || 0) > 0);
        if (!lista.length || lista.every(i => (parseInt(i.cantidad_surtida, 10) || 0) <= 0)) return 'PENDIENTE';
        if (!medibles.length) return 'PARCIAL_SELLADA';
        if (medibles.every(i => (parseInt(i.cantidad_surtida, 10) || 0) >= (parseInt(i.cantidad_prescrita, 10) || 1))) return 'COMPLETA_RETENIDA';
        return 'PARCIAL_SELLADA';
    }
    function emitirReceta(entrada, s) {
        if (!puedeEmitirRecetaMedica(s && s.rol)) return { ok: false, motivo: 'La receta la emite el médico.' };
        const tipos = ['APLICACION_CONSULTA', 'RECETA_CASA', 'CONTROLADO_HOSPITAL', 'EXTERNA'];
        const tipo = tipos.indexOf(entrada && entrada.tipo_origen) >= 0 ? entrada.tipo_origen : 'CONTROLADO_HOSPITAL';
        const t = entrada && entrada.turno_id ? obtenerTurno(entrada.turno_id) : null;
        const pacienteId = (entrada && entrada.paciente_id) || (t && t.paciente_id);
        if (!pacienteId && !t) return { ok: false, motivo: 'La receta necesita un paciente o un turno.' };
        const crudos = (entrada && entrada.items) || [];
        if (!crudos.length) return { ok: false, motivo: 'Agregue al menos un medicamento.' };
        const armados = armarItemsReceta(tipo, crudos);
        if (!armados.ok) return armados;
        const items = armados.items;
        const folioExterno = limpiarEspacios((entrada && entrada.folio_externo) || '').toUpperCase();
        if (tipo === 'EXTERNA' && folioExterno.length < 3) return { ok: false, motivo: 'Anote el folio del recetario físico (mínimo 3 caracteres).' };
        if (tipo === 'EXTERNA' && listarRecetas().some(r => normalizar(r.folio_externo) === normalizar(folioExterno))) return { ok: false, motivo: 'Ese folio de recetario ya está registrado.' };
        const internamiento = t ? internamientoDeTurno(t.turno_id) : null;
        const medico = (s && USUARIOS[s.usuario_id]) || s || {};
        const folio = reservarFolioReceta();
        const receta = Object.assign({
            receta_id: uid('RX'),
            folio: folio,
            folio_externo: tipo === 'EXTERNA' ? folioExterno : '',
            tipo_origen: tipo,
            fecha_hora: new Date().toISOString(),
            turno_id: t ? t.turno_id : null,
            internamiento_id: internamiento ? internamiento.internamiento_id : null,
            medico_id: s.usuario_id,
            medico_nombre: s.nombre,
            medico_especialidad: (especialidadPorCodigo(medico.especialidad_codigo) || {}).nombre || medico.cargo || (s && s.especialidad) || '',
            cedulas_impresas: textoCedulasFirma(medico),
            diagnostico: limpiarEspacios((entrada && entrada.diagnostico) || (t && t.dx_principal) || ''),
            items: items,
            estatus_surtido: 'PENDIENTE'
        }, fichaPacienteReceta(pacienteId, t));
        if (!escribir(CLAVES.recetas, listarRecetas().concat([receta]))) {
            devolverFolioReceta(folio);
            return { ok: false, motivo: 'No se pudo guardar la receta. El folio no se consumió.' };
        }
        return { ok: true, receta: receta, producto: items[0].sku ? productoPorSku(items[0].sku) : null };
    }
    function armarItemsReceta(tipo, crudos) {
        const items = [];
        for (let k = 0; k < (crudos || []).length; k++) {
            const crudo = crudos[k] || {};
            const prod = crudo.sku ? productoPorSku(crudo.sku) : null;
            if (tipo === 'RECETA_CASA' && !prod) {
                const nombre = limpiarEspacios(crudo.nombre);
                if (nombre.length < 2) return { ok: false, motivo: 'Escriba el medicamento de la receta para casa.' };
                const cantidad = parseInt(crudo.cantidad, 10);
                items.push({
                    sku: null, nombre: nombre, libre: true,
                    concentracion: limpiarEspacios(crudo.concentracion || ''),
                    forma_farmaceutica: limpiarEspacios(crudo.presentacion || crudo.forma_farmaceutica || ''),
                    fraccion_cofepris: 'NA', clasificacion_aware: null,
                    dosis_indicacion: limpiarEspacios(crudo.dosis_indicacion || crudo.dosis || ''),
                    cantidad_prescrita: cantidad >= 1 && cantidad <= 99 ? cantidad : 1,
                    cantidad_surtida: 0, lotes_surtidos: []
                });
                continue;
            }
            if (!prod) return { ok: false, motivo: 'La aplicación en clínica solo admite medicamentos del inventario del hospital.' };
            const item = itemRecetaDesdeProducto(prod, crudo);
            if (crudo.concentracion) item.concentracion = limpiarEspacios(crudo.concentracion);
            if (crudo.presentacion) item.forma_farmaceutica = limpiarEspacios(crudo.presentacion);
            items.push(item);
        }
        if (!items.length) return { ok: false, motivo: 'Agregue al menos un medicamento.' };
        return { ok: true, items: items };
    }
    function encolarOrdenAplicacion(turno, receta) {
        if (!turno || !receta) return null;
        return guardarSolicitud({
            solicitud_id: uid('SR'), estatus: 'pendiente', origen: 'consulta', receta_id: receta.receta_id, folio: receta.folio,
            hoja_id: null, turno_id: turno.turno_id, internamiento_id: null, paciente_id: turno.paciente_id, cama: null,
            creada_en: new Date().toISOString(),
            lineas: (receta.items || []).map(i => nuevaLineaSurtido({
                nombre: [i.nombre, i.dosis_indicacion].filter(Boolean).join(' — '),
                cantidad: i.cantidad_prescrita || 1, sku: i.sku
            }))
        });
    }
    function sincronizarColaDeReceta(receta) {
        if (!receta || receta.tipo_origen !== 'APLICACION_CONSULTA') return;
        const cola = listarSurtido();
        let cambio = false;
        cola.forEach(sol => {
            if (sol.receta_id !== receta.receta_id || sol.estatus === 'cancelada' || sol.estatus === 'surtida') return;
            if (receta.estatus_surtido === 'CANCELADA') { sol.estatus = 'cancelada'; cambio = true; return; }
            if ((sol.lineas || []).some(l => (l.cantidad_surtida || 0) > 0)) return;
            sol.lineas = (receta.items || []).map(i => nuevaLineaSurtido({
                nombre: [i.nombre, i.dosis_indicacion].filter(Boolean).join(' — '),
                cantidad: i.cantidad_prescrita || 1, sku: i.sku
            }));
            cambio = true;
        });
        if (cambio) escribir(CLAVES.surtido, cola);
    }
    function reflejarSurtidoEnCola(receta) {
        if (!receta || receta.tipo_origen !== 'APLICACION_CONSULTA') return;
        const cola = listarSurtido();
        let cambio = false;
        cola.forEach(sol => {
            if (sol.receta_id !== receta.receta_id || sol.estatus === 'cancelada') return;
            (sol.lineas || []).forEach(l => {
                const item = (receta.items || []).find(i => l.sku && i.sku && normalizar(i.sku) === normalizar(l.sku));
                if (!item) return;
                const surtida = parseInt(item.cantidad_surtida, 10) || 0;
                if ((l.cantidad_surtida || 0) !== surtida) { l.cantidad_surtida = surtida; cambio = true; }
                const est = surtida >= (l.cantidad || 1) ? 'surtida' : 'pendiente';
                if (l.estatus !== est) { l.estatus = est; cambio = true; }
            });
            if ((sol.lineas || []).length && sol.lineas.every(l => l.estatus === 'surtida') && sol.estatus !== 'surtida') {
                sol.estatus = 'surtida'; sol.surtida_en = new Date().toISOString(); cambio = true;
            }
        });
        if (cambio) escribir(CLAVES.surtido, cola);
    }
    function actualizarOrdenEnTurno(receta) {
        const t = receta && receta.turno_id ? obtenerTurno(receta.turno_id) : null;
        if (!t) return null;
        const ordenes = (t.ordenes_aplicacion || []).map(o => {
            if (o.receta_id !== receta.receta_id) return o;
            return Object.assign({}, o, {
                estatus: receta.estatus_surtido,
                items: (receta.items || []).map(i => ({ sku: i.sku, nombre: i.nombre, dosis_indicacion: i.dosis_indicacion, cantidad_prescrita: i.cantidad_prescrita }))
            });
        });
        return actualizarTurno(t.turno_id, { ordenes_aplicacion: ordenes });
    }
    function enviarOrdenAplicacion(entrada, s) {
        const t = obtenerTurno(entrada && entrada.turno_id);
        if (!t) return { ok: false, motivo: 'No hay un turno activo para la orden.' };
        const emitida = emitirReceta(Object.assign({}, entrada, { turno_id: t.turno_id, tipo_origen: 'APLICACION_CONSULTA' }), s);
        if (!emitida.ok) return emitida;
        const orden = {
            orden_id: uid('OA'),
            receta_id: emitida.receta.receta_id,
            folio: emitida.receta.folio,
            fecha_hora: emitida.receta.fecha_hora,
            medico_id: emitida.receta.medico_id,
            medico_nombre: emitida.receta.medico_nombre,
            items: emitida.receta.items.map(i => ({ sku: i.sku, nombre: i.nombre, dosis_indicacion: i.dosis_indicacion, cantidad_prescrita: i.cantidad_prescrita }))
        };
        const guardado = actualizarTurno(t.turno_id, { ordenes_aplicacion: (t.ordenes_aplicacion || []).concat([orden]) });
        if (!guardado) return { ok: false, motivo: 'La receta quedó foliada, pero no se pudo avisar a enfermería. Reimprímala desde el archivo.' };
        encolarOrdenAplicacion(guardado, emitida.receta);
        return { ok: true, receta: emitida.receta, orden: orden, turno: guardado };
    }
    function guardarBorradorRecetaCasa(turnoId, items) {
        const t = obtenerTurno(turnoId);
        if (!t) return null;
        return actualizarTurno(turnoId, { receta_casa_borrador: items || [] });
    }
    function modificarRecetaPendiente(recetaId, itemsNuevos, s) {
        if (!puedeEmitirRecetaMedica(s && s.rol)) return { ok: false, motivo: 'La receta la modifica el médico.' };
        const receta = listarRecetas().find(r => r.receta_id === recetaId);
        if (!receta) return { ok: false, motivo: 'No se encontró la receta.' };
        if (receta.estatus_surtido !== 'PENDIENTE') return { ok: false, motivo: 'Farmacia ya surtió o la orden ya no está pendiente. No se puede cambiar el medicamento.' };
        const cola = listarSurtido().filter(sol => sol.receta_id === recetaId && sol.estatus === 'pendiente');
        if (cola.some(sol => (sol.lineas || []).some(l => (l.cantidad_surtida || 0) > 0))) return { ok: false, motivo: 'Farmacia ya empezó a surtir esta orden.' };
        const armados = armarItemsReceta(receta.tipo_origen, itemsNuevos);
        if (!armados.ok) return armados;
        const actualizada = Object.assign({}, receta, { items: armados.items, estatus_surtido: 'PENDIENTE' });
        const lista = listarRecetas().map(r => r.receta_id === recetaId ? actualizada : r);
        if (!escribir(CLAVES.recetas, lista)) return { ok: false, motivo: 'No se pudo guardar el cambio.' };
        if (receta.tipo_origen === 'APLICACION_CONSULTA') {
            sincronizarColaDeReceta(actualizada);
            actualizarOrdenEnTurno(actualizada);
        }
        return { ok: true, receta: actualizada };
    }
    function cancelarRecetaConsulta(recetaId, s) {
        if (!puedeEmitirRecetaMedica(s && s.rol)) return { ok: false, motivo: 'La receta la cancela el médico.' };
        const receta = listarRecetas().find(r => r.receta_id === recetaId);
        if (!receta) return { ok: false, motivo: 'No se encontró la receta.' };
        if (receta.estatus_surtido === 'CANCELADA') return { ok: true, receta: receta };
        if (receta.estatus_surtido !== 'PENDIENTE') return { ok: false, motivo: 'Ya fue surtida. No se puede cancelar.' };
        const actualizada = Object.assign({}, receta, { estatus_surtido: 'CANCELADA', cancelada_en: new Date().toISOString() });
        const lista = listarRecetas().map(r => r.receta_id === recetaId ? actualizada : r);
        if (!escribir(CLAVES.recetas, lista)) return { ok: false, motivo: 'No se pudo cancelar.' };
        if (receta.tipo_origen === 'APLICACION_CONSULTA') {
            sincronizarColaDeReceta(actualizada);
            actualizarOrdenEnTurno(actualizada);
        }
        return { ok: true, receta: actualizada };
    }
    function registrarSurtidoReceta(folio, lineas) {
        const receta = recetaPorFolio(folio);
        if (!receta || !(lineas || []).length) return null;
        const items = (receta.items || []).map(item => {
            const copia = Object.assign({}, item, { lotes_surtidos: (item.lotes_surtidos || []).slice() });
            (lineas || []).forEach(lin => {
                if (normalizar(lin.sku) !== normalizar(item.sku)) return;
                const pedida = parseInt(item.cantidad_prescrita, 10) || 0;
                const ya = parseInt(copia.cantidad_surtida, 10) || 0;
                let n = parseInt(lin.cantidad, 10) || 0;
                if (pedida > 0) n = Math.min(n, Math.max(0, pedida - ya));
                if (n <= 0) return;
                copia.cantidad_surtida = ya + n;
                if (lin.lote) copia.lotes_surtidos.push({ lote: lin.lote, cantidad: n, fecha_hora: new Date().toISOString() });
            });
            return copia;
        });
        const actualizada = Object.assign({}, receta, { items: items, estatus_surtido: estatusSurtidoDe(items) });
        const lista = listarRecetas().map(r => r.receta_id === receta.receta_id ? actualizada : r);
        if (!escribir(CLAVES.recetas, lista)) return null;
        reflejarSurtidoEnCola(actualizada);
        return actualizada;
    }
    function etiquetaEstatusReceta(estatus) {
        if (estatus === 'CANCELADA') return 'Cancelada';
        if (estatus === 'COMPLETA_RETENIDA') return 'Surtido completo';
        if (estatus === 'PARCIAL_SELLADA') return 'Surtido parcial';
        return 'Pendiente de surtir';
    }
    function pendienteItemReceta(item) {
        if (!item) return 0;
        const pedida = parseInt(item.cantidad_prescrita, 10) || 0;
        const surtida = parseInt(item.cantidad_surtida, 10) || 0;
        if (pedida <= 0) return 0;
        return Math.max(0, pedida - surtida);
    }
    function pendienteFolioSku(folio, sku) {
        const receta = recetaPorFolio(folio);
        if (!receta) return null;
        const item = (receta.items || []).find(i => normalizar(i.sku) === normalizar(sku));
        if (!item || !(parseInt(item.cantidad_prescrita, 10) > 0)) return null;
        return pendienteItemReceta(item);
    }
    function textoSurtidoItem(item) {
        const pedida = parseInt(item && item.cantidad_prescrita, 10) || 0;
        const surtida = parseInt(item && item.cantidad_surtida, 10) || 0;
        if (pedida > 0 && surtida >= pedida) return surtida + ' de ' + pedida + ' — Retener receta física';
        if (pedida > 0) return 'Surtidas: ' + surtida + ' de ' + pedida + ' — Pendientes: ' + (pedida - surtida);
        if (surtida > 0) return 'Surtidas: ' + surtida + ' — Sellada, se devolvió la receta';
        return 'Pendiente de surtir';
    }
    function cedulaDeUsuario(id) {
        const u = id && USUARIOS[id];
        if (!u) return '';
        return resumenCedulas(u) || u.cedula_profesional || '';
    }
    function inferirTipoRespaldo(folio, fraccion, folioEspecial) {
        if (fraccion === 'I' || limpiarEspacios(folioEspecial || '')) return 'Receta Especial Fracción I';
        const f = limpiarEspacios(folio || '').toUpperCase();
        if (f.indexOf('SB-REC') === 0) return 'Receta Interna (SB-REC)';
        if (f.indexOf('IND-') === 0 || f.indexOf('IM-') === 0) return 'Indicaciones Hospitalarias (IND)';
        if (f.indexOf('EXT-') === 0) return 'Receta Externa (EXT)';
        return '';
    }
    function textoEstatusBitacora(tipo, folio, sku, cantidadExtra) {
        if (tipo === 'Receta Especial Fracción I') return 'Retenida';
        if (tipo === 'Indicaciones Hospitalarias (IND)') return 'Expediente Hospitalario';
        const receta = recetaPorFolio(folio);
        if (!receta) return tipo === 'Receta Externa (EXT)' ? 'Retenida' : '';
        const item = (receta.items || []).find(i => !sku || normalizar(i.sku) === normalizar(sku));
        const surtida = ((item && parseInt(item.cantidad_surtida, 10)) || 0) + (parseInt(cantidadExtra, 10) || 0);
        const pedida = (item && parseInt(item.cantidad_prescrita, 10)) || 0;
        if (receta.estatus_surtido === 'COMPLETA_RETENIDA' && !(pedida > 0 && surtida < pedida)) return 'Retenida';
        if (pedida > 0 && surtida >= pedida) return 'Retenida';
        if (pedida > 0 && surtida > 0) return 'Sellada Parcial (' + surtida + '/' + pedida + ')';
        if (surtida > 0 || receta.estatus_surtido === 'PARCIAL_SELLADA') return 'Sellada Parcial';
        return '';
    }
    function respaldoParaSurtido(turnoId, sku) {
        const t = obtenerTurno(turnoId);
        const prod = productoPorSku(sku);
        if (!t || !prod) return null;
        const recetas = recetasDeTurno(turnoId).filter(r => r.tipo_origen !== 'RECETA_CASA' && r.estatus_surtido !== 'CANCELADA' && (r.items || []).some(i => normalizar(i.sku) === normalizar(sku) && pendienteItemReceta(i) > 0));
        if (recetas.length) {
            const r = recetas[recetas.length - 1];
            const item = r.items.find(i => normalizar(i.sku) === normalizar(sku));
            const externa = r.tipo_origen === 'EXTERNA' || String(r.folio || '').indexOf('EXT-') === 0;
            return {
                folio: r.folio, tipo_respaldo: externa ? 'Receta Externa (EXT)' : 'Receta Interna (SB-REC)',
                medico_id: r.medico_id || '', medico_nombre: r.medico_nombre || '',
                cedula: r.cedulas_impresas || cedulaDeUsuario(r.medico_id),
                pendiente: pendienteItemReceta(item), receta_id: r.receta_id, dosis: item.dosis_indicacion || ''
            };
        }
        const area = clasificarAreaFarmacia(t);
        const enPiso = area === 'hospital' || area === 'observacion' || area === 'quirofano';
        if (enPiso && prod.fraccion_cofepris === 'IV_ANTIBIOTICO') {
            const hoja = indicacionesVigentes(internamientoDeTurno(t.turno_id));
            if (hoja && hoja.folio) {
                const medico = USUARIOS[hoja.autor_id] || USUARIOS[t.medico_id];
                return {
                    folio: hoja.folio, tipo_respaldo: 'Indicaciones Hospitalarias (IND)',
                    medico_id: (medico && medico.id) || hoja.autor_id || t.medico_id || '',
                    medico_nombre: (medico && medico.nombre) || hoja.autor_nombre || t.medico_nombre || '',
                    cedula: cedulaDeUsuario(medico && medico.id),
                    pendiente: null, receta_id: null, dosis: ''
                };
            }
        }
        return null;
    }
    function lotesVigentesDeSku(sku) {
        const hoy = hoyLocal();
        return listarFarmacia().filter(p => normalizar(p.sku) === normalizar(sku) && p.stock > 0 && String(p.caducidad) >= hoy)
            .sort((a, b) => String(a.caducidad).localeCompare(String(b.caducidad)) || String(a.lote).localeCompare(String(b.lote)));
    }
    function loteParaSurtir(sku) { return lotesVigentesDeSku(sku)[0] || null; }
    function lineasSugeridasDeReceta(receta, soloSku, cantidadForzada) {
        if (!receta || receta.estatus_surtido === 'CANCELADA' || receta.tipo_origen === 'RECETA_CASA') return [];
        const externa = receta.tipo_origen === 'EXTERNA' || String(receta.folio || '').indexOf('EXT-') === 0;
        const tipo = externa ? 'Receta Externa (EXT)' : 'Receta Interna (SB-REC)';
        const cedula = receta.cedulas_impresas || cedulaDeUsuario(receta.medico_id);
        const out = [];
        (receta.items || []).forEach(item => {
            if (soloSku && normalizar(item.sku) !== normalizar(soloSku)) return;
            const pedida = parseInt(item.cantidad_prescrita, 10) || 0;
            const pendiente = pedida > 0 ? pendienteItemReceta(item) : 0;
            if (pedida > 0 && pendiente <= 0) return;
            if (pedida <= 0 && (parseInt(item.cantidad_surtida, 10) || 0) > 0 && receta.estatus_surtido === 'COMPLETA_RETENIDA') return;
            const lote = loteParaSurtir(item.sku);
            if (!lote) return;
            const tope = pedida > 0 ? pendiente : lote.stock;
            const cant = Math.min(cantidadForzada ? parseInt(cantidadForzada, 10) || 1 : tope, tope, lote.stock);
            if (cant < 1) return;
            out.push({
                lote_id: lote.lote_id, sku: lote.sku, cantidad: cant, folio_confirmado: true, confirmar_lote: true,
                folio_receta: receta.folio, medico_prescriptor_id: receta.medico_id || '',
                medico_prescriptor_nombre: receta.medico_nombre || '',
                cedula_prescriptor: cedula, tipo_respaldo: tipo
            });
        });
        return out;
    }
    function reservarFolioExterno() {
        const actual = parseInt(localStorage.getItem(CLAVES.folioExternoSeq) || '0', 10) || 0;
        const siguiente = actual + 1;
        localStorage.setItem(CLAVES.folioExternoSeq, String(siguiente));
        return 'EXT-' + String(siguiente).padStart(5, '0');
    }
    function devolverFolioExterno(folio) {
        const n = parseInt(String(folio || '').replace(/\D/g, ''), 10);
        const actual = parseInt(localStorage.getItem(CLAVES.folioExternoSeq) || '0', 10) || 0;
        if (n && n === actual) localStorage.setItem(CLAVES.folioExternoSeq, String(n - 1));
    }
    function fijarDisposicionReceta(folio, disposicion) {
        const receta = recetaPorFolio(folio);
        if (!receta) return null;
        const items = (receta.items || []).map(item => {
            const copia = Object.assign({}, item);
            const surtida = parseInt(copia.cantidad_surtida, 10) || 0;
            if (disposicion === 'completa') copia.cantidad_prescrita = Math.max(parseInt(copia.cantidad_prescrita, 10) || 0, surtida);
            return copia;
        });
        const estatus = disposicion === 'completa' ? 'COMPLETA_RETENIDA' : (disposicion === 'parcial' ? 'PARCIAL_SELLADA' : estatusSurtidoDe(items));
        const actualizada = Object.assign({}, receta, { items: items, estatus_surtido: estatus, disposicion_receta: disposicion || receta.disposicion_receta || '' });
        const lista = listarRecetas().map(r => r.receta_id === receta.receta_id ? actualizada : r);
        return escribir(CLAVES.recetas, lista) ? actualizada : null;
    }
    function confirmarSurtidoMostrador(entrada, s) {
        if (!puedeGestionarFarmacia(s)) return { ok: false, motivo: 'Su perfil no puede surtir en mostrador.' };
        const operador = entrada && entrada.operador_id ? USUARIOS[entrada.operador_id] : null;
        const quien = operador && operador.activo !== false
            ? { id: operador.id, nombre: operador.nombre, cedula_profesional: operador.cedula_profesional || '' }
            : { id: s.usuario_id, nombre: s.nombre, cedula_profesional: cedulaDeUsuario(s.usuario_id) };
        const lineas = (entrada && entrada.lineas) || [];
        if (!lineas.length) return { ok: false, motivo: 'El carrito está vacío.' };
        const externo = entrada.externo || {};
        const catalogo = listarFarmacia();
        const descuentos = {};
        const sinFolio = [];
        for (let k = 0; k < lineas.length; k++) {
            const lin = lineas[k];
            const prod = catalogo.find(p => p.lote_id === lin.lote_id);
            if (!prod) return { ok: false, motivo: 'Un lote del carrito ya no está en el inventario.' };
            const cant = parseInt(lin.cantidad, 10);
            if (!Number.isInteger(cant) || cant < 1 || cant > 99) return { ok: false, motivo: 'Cantidad inválida de ' + prod.nombre + '.' };
            if (String(prod.caducidad) < hoyLocal()) return { ok: false, motivo: prod.nombre + ' está caducado.' };
            if (prod.fraccion_cofepris === 'I') return { ok: false, motivo: 'El estupefaciente de fracción I se surte desde una caja abierta, no en mostrador.' };
            if (prod.stock < (descuentos[prod.lote_id] || 0) + cant) return { ok: false, motivo: 'No hay stock suficiente de ' + prod.nombre + '.' };
            descuentos[prod.lote_id] = (descuentos[prod.lote_id] || 0) + cant;
            const tope = pendienteFolioSku(lin.folio_receta, prod.sku);
            if (tope !== null && cant > tope) return { ok: false, motivo: 'De ' + lin.folio_receta + ' solo faltan ' + tope + ' piezas de ' + prod.nombre + '.' };
            if (FRACCIONES_RECETA.indexOf(prod.fraccion_cofepris) >= 0 && !limpiarEspacios(lin.folio_receta)) sinFolio.push(prod);
        }
        if (sinFolio.length) {
            if (!limpiarEspacios(externo.paciente_nombre)) return { ok: false, motivo: 'Indique el nombre del paciente externo.' };
            if (!limpiarEspacios(externo.medico_nombre)) return { ok: false, motivo: 'Indique el nombre del médico externo.' };
            if (!limpiarEspacios(externo.cedula)) return { ok: false, motivo: 'Indique la cédula profesional del médico externo.' };
        } else if (lineas.some(l => !limpiarEspacios(l.folio_receta)) && !limpiarEspacios(externo.paciente_nombre)) {
            return { ok: false, motivo: 'Indique el nombre del paciente externo.' };
        }
        let folioNuevo = limpiarEspacios(externo.folio_fisico || '').toUpperCase();
        let generado = false;
        if (sinFolio.length && folioNuevo.length < 3) {
            folioNuevo = reservarFolioExterno();
            generado = true;
        }
        const snapCat = JSON.stringify(catalogo);
        const snapRec = localStorage.getItem(CLAVES.recetas);
        const snapMov = localStorage.getItem(CLAVES.movimientosFarmacia);
        Object.keys(descuentos).forEach(id => { catalogo.find(p => p.lote_id === id).stock -= descuentos[id]; });
        if (!escribir(CLAVES.farmacia, catalogo)) return { ok: false, motivo: 'No se pudo actualizar el inventario.' };
        const revertir = () => {
            escribir(CLAVES.farmacia, JSON.parse(snapCat));
            if (snapRec === null) localStorage.removeItem(CLAVES.recetas); else localStorage.setItem(CLAVES.recetas, snapRec);
            if (snapMov === null) localStorage.removeItem(CLAVES.movimientosFarmacia); else localStorage.setItem(CLAVES.movimientosFarmacia, snapMov);
            if (generado) devolverFolioExterno(folioNuevo);
        };
        if (sinFolio.length && folioNuevo && !recetaPorFolio(folioNuevo)) {
            const items = [];
            const vistos = {};
            lineas.forEach(lin => {
                if (limpiarEspacios(lin.folio_receta) && normalizar(lin.folio_receta) !== normalizar(folioNuevo)) return;
                const prod = catalogo.find(p => p.lote_id === lin.lote_id);
                if (!prod || vistos[prod.sku]) return;
                if (FRACCIONES_RECETA.indexOf(prod.fraccion_cofepris) < 0 && limpiarEspacios(lin.folio_receta)) return;
                vistos[prod.sku] = true;
                const cant = lineas.filter(otra => {
                    const p2 = catalogo.find(p => p.lote_id === otra.lote_id);
                    return p2 && p2.sku === prod.sku && (!limpiarEspacios(otra.folio_receta) || normalizar(otra.folio_receta) === normalizar(folioNuevo));
                }).reduce((s, otra) => s + (parseInt(otra.cantidad, 10) || 0), 0);
                const item = itemRecetaDesdeProducto(prod, { dosis_indicacion: '', cantidad: externo.disposicion === 'completa' ? cant : 0 });
                item.cantidad_prescrita = externo.disposicion === 'completa' ? cant : 0;
                item.cantidad_surtida = 0;
                items.push(item);
                lineas.forEach(otra => {
                    const p2 = catalogo.find(p => p.lote_id === otra.lote_id);
                    if (p2 && p2.sku === prod.sku && !limpiarEspacios(otra.folio_receta)) {
                        otra.folio_receta = folioNuevo;
                        otra.tipo_respaldo = 'Receta Externa (EXT)';
                        otra.medico_prescriptor_nombre = limpiarEspacios(externo.medico_nombre);
                        otra.cedula_prescriptor = limpiarEspacios(externo.cedula);
                    }
                });
            });
            const receta = {
                receta_id: uid('RX'), folio: folioNuevo, folio_externo: generado ? '' : folioNuevo,
                tipo_origen: 'EXTERNA', fecha_hora: new Date().toISOString(),
                turno_id: null, internamiento_id: null, paciente_id: null,
                paciente_nombre: limpiarEspacios(externo.paciente_nombre), paciente_edad: null,
                paciente_telefono: limpiarEspacios(externo.telefono || ''), paciente_direccion: limpiarEspacios(externo.direccion || ''),
                medico_id: '', medico_nombre: limpiarEspacios(externo.medico_nombre),
                cedulas_impresas: limpiarEspacios(externo.cedula), institucion_medico: limpiarEspacios(externo.institucion || ''),
                diagnostico: '', items: items, estatus_surtido: 'PENDIENTE'
            };
            if (!escribir(CLAVES.recetas, listarRecetas().concat([receta]))) { revertir(); return { ok: false, motivo: 'No se pudo guardar la receta externa.' }; }
        } else if (sinFolio.length && folioNuevo) {
            lineas.forEach(lin => {
                if (!limpiarEspacios(lin.folio_receta)) {
                    lin.folio_receta = folioNuevo;
                    lin.tipo_respaldo = 'Receta Externa (EXT)';
                    lin.medico_prescriptor_nombre = limpiarEspacios(externo.medico_nombre);
                    lin.cedula_prescriptor = limpiarEspacios(externo.cedula);
                }
            });
        }
        const porFolio = {};
        lineas.forEach(lin => {
            const prod = catalogo.find(p => p.lote_id === lin.lote_id);
            const folio = limpiarEspacios(lin.folio_receta).toUpperCase();
            if (!folio || !prod) return;
            if (!porFolio[folio]) porFolio[folio] = [];
            porFolio[folio].push({ sku: prod.sku, cantidad: parseInt(lin.cantidad, 10) || 1, lote: prod.lote });
        });
        Object.keys(porFolio).forEach(folio => registrarSurtidoReceta(folio, porFolio[folio]));
        if (externo.disposicion === 'completa' || externo.disposicion === 'parcial') {
            const vistos = {};
            if (folioNuevo) vistos[folioNuevo] = true;
            Object.keys(porFolio).forEach(folio => {
                const receta = recetaPorFolio(folio);
                if (receta && receta.tipo_origen === 'EXTERNA') vistos[folio] = true;
            });
            Object.keys(vistos).forEach(folio => fijarDisposicionReceta(folio, externo.disposicion));
        }
        const basePaciente = folioNuevo && recetaPorFolio(folioNuevo);
        const movs = lineas.map(lin => {
            const prod = catalogo.find(p => p.lote_id === lin.lote_id);
            const receta = recetaPorFolio(lin.folio_receta) || basePaciente;
            const tipo = lin.tipo_respaldo || inferirTipoRespaldo(lin.folio_receta, prod.fraccion_cofepris);
            const cant = parseInt(lin.cantidad, 10) || 1;
            return movimientoSalida(prod, cant, quien, {
                paciente_nombre: (receta && receta.paciente_nombre) || limpiarEspacios(externo.paciente_nombre),
                paciente_telefono: (receta && receta.paciente_telefono) || limpiarEspacios(externo.telefono || ''),
                paciente_direccion: (receta && receta.paciente_direccion) || limpiarEspacios(externo.direccion || ''),
                area_paciente: receta && receta.tipo_origen && receta.tipo_origen !== 'EXTERNA' ? 'Surtido por folio' : 'Mostrador / Receta externa',
                medico_tratante: (receta && receta.medico_nombre) || limpiarEspacios(externo.medico_nombre),
                folio_receta: lin.folio_receta || '',
                tipo_respaldo: tipo,
                medico_prescriptor: lin.medico_prescriptor_nombre || (receta && receta.medico_nombre) || limpiarEspacios(externo.medico_nombre),
                cedula_prescriptor: lin.cedula_prescriptor || (receta && receta.cedulas_impresas) || limpiarEspacios(externo.cedula),
                estatus_receta: textoEstatusBitacora(tipo, lin.folio_receta, prod.sku, 0)
            });
        });
        if (movs.length && !anexarMovimientos(movs)) { revertir(); return { ok: false, motivo: 'No se pudo registrar la bitácora. El inventario no se modificó.' }; }
        return { ok: true, folio: folioNuevo, generado: generado, receta: folioNuevo ? recetaPorFolio(folioNuevo) : null, disposicion: externo.disposicion || '' };
    }
    function htmlHojaReceta(receta) {
        if (!receta) return '';
        return htmlRecetaCarta(modeloRecetaOficial(receta));
    }
    function folioRecetaVigente(turnoId, sku) {
        const nuevas = recetasDeTurno(turnoId).filter(r => !sku || (r.items || []).some(i => normalizar(i.sku) === normalizar(sku)));
        if (nuevas.length) {
            const r = nuevas[nuevas.length - 1];
            return {
                folio: r.folio_externo || r.folio,
                folio_sistema: r.folio,
                medico_id: r.medico_id,
                medico_nombre: r.medico_nombre,
                origen: r.tipo_origen === 'EXTERNA' ? 'fisica' : 'sistema',
                receta: r
            };
        }
        const lista = listarRecetasFoliadas().filter(r => r.turno_id === turnoId && (!sku || normalizar(r.sku) === normalizar(sku)));
        return lista.length ? lista[lista.length - 1] : null;
    }
    function guardarRecetaFoliada(entrada, s) {
        if (!puedeEmitirRecetaMedica(s && s.rol)) return { ok: false, motivo: 'Solo el médico puede vincular la receta foliada.' };
        const op = entrada || {};
        const t = obtenerTurno(op.turno_id);
        const prod = productoPorSku(op.sku);
        if (!t || !prod) return { ok: false, motivo: 'No se encontró el paciente o el medicamento.' };
        const fr = prod.fraccion_cofepris;
        if (fr !== 'II' && fr !== 'III' && fr !== 'IV_ANTIBIOTICO') return { ok: false, motivo: 'Este medicamento no exige receta foliada de fracción II, III o antibiótico.' };
        const internado = t.estatus === 'internado' || t.estatus === 'internado_en_proceso';
        if (internado && fr === 'IV_ANTIBIOTICO') {
            const i = internamientoDeTurno(t.turno_id);
            const hoja = i && indicacionesVigentes(i);
            return { ok: false, motivo: 'Este antibiótico queda amparado por la hoja de indicaciones ' + ((hoja && hoja.folio) || 'vigente') + '. No se genera una receta suelta.' };
        }
        return emitirReceta({
            turno_id: t.turno_id,
            tipo_origen: op.origen === 'fisica' ? 'EXTERNA' : 'CONTROLADO_HOSPITAL',
            folio_externo: op.folio,
            items: [{ sku: prod.sku, dosis_indicacion: op.dosis || prod.nombre, cantidad: 1 }]
        }, s);
    }
    function datosReceta(op) {
        const p = op.producto || {};
        const fraccion = op.fraccion || p.fraccion_cofepris || 'NA';
        return {
            tipo: op.tipo || 'respaldo',
            titulo: op.folio_sistema ? ('Receta médica ' + op.folio_sistema) : (op.tipo === 'individual' ? 'Receta individual de estupefaciente' : 'Receta de respaldo'),
            folio_sistema: op.folio_sistema || '',
            fraccion: fraccion, etiqueta: etiquetaNormativa(fraccion) || nombreFraccionCofepris(fraccion),
            paciente: op.paciente || '', edad: op.edad || '', cama: op.cama || '',
            medico: op.medico || '', cedula: op.cedula || '', cedulas_texto: op.cedulas_texto || '',
            denominacion: op.denominacion || p.nombre || '', dosis: op.dosis || '',
            lote: op.lote || p.lote || '', laboratorio: op.laboratorio || p.laboratorio || '',
            fecha: op.fecha || new Date().toISOString(),
            numero: op.numero || null, de: op.de || null,
            folio_receta_especial: op.folio_receta_especial || '',
            datos_postanestesicos: op.datos_postanestesicos || '',
            expediente: op.expediente || op.paciente_id || '',
            fecha_nacimiento: op.fecha_nacimiento || '',
            peso: op.peso || '',
            talla: op.talla || '',
            alergias: op.alergias || '',
            especialidad: op.especialidad || '',
            presentacion: op.presentacion || [p.concentracion, nombreFormaFarmaceutica(p.forma_farmaceutica)].filter(Boolean).join(' · '),
            cantidad: op.cantidad || (op.numero ? String(op.numero) : '')
        };
    }
    function conUnidadReceta(valor, unidad, pista) {
        if (valor === null || valor === undefined || valor === '') return '';
        const s = String(valor);
        if (pista && s.toLowerCase().indexOf(pista) >= 0) return s;
        return s + ' ' + unidad;
    }
    function marcaAguaReceta() {
        return '<div style="position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);width:280px;text-align:center;opacity:0.08;pointer-events:none;">'
            + '<img src="logo-belen.png" alt="" onerror="this.style.display=\'none\'" style="width:130px;height:auto;display:block;margin:0 auto 4px;">'
            + '<svg viewBox="0 0 280 78" width="280" height="78" aria-hidden="true"><defs><path id="arco-sb" d="M18,70 A122,122 0 0,1 262,70"></path></defs>'
            + '<text fill="#0b3a5b" font-size="15" font-family="Arial,sans-serif" letter-spacing="2.5"><textPath href="#arco-sb" xlink:href="#arco-sb" startOffset="50%" text-anchor="middle">SANATORIO BELÉN</textPath></text></svg>'
            + '<div style="font-size:64px;line-height:1;margin-top:-16px;">&#9764;</div></div>';
    }
    function htmlRecetaCarta(m) {
        const e = escHtmlCuenta;
        const dato = (etiqueta, valor, ancho) => etiqueta + ' <span style="display:inline-block;border-bottom:1px solid #000;min-width:' + ancho + ';font-weight:bold;padding:0 4px;">' + (valor ? e(valor) : '&nbsp;') + '</span>';
        const meds = (m.medicamentos && m.medicamentos.length) ? m.medicamentos.map((med, i) => {
            const cabeza = [med.nombre, med.presentacion, med.cantidad].filter(x => x !== undefined && x !== null && String(x) !== '').join(' · ');
            return '<div style="margin:0 0 12px;"><p style="margin:0;font-weight:bold;">' + (i + 1) + '. ' + e(cabeza) + '</p><p style="margin:3px 0 0 18px;white-space:pre-wrap;">' + e(med.instrucciones || '') + '</p></div>';
        }).join('') : '<p style="margin:0;">&nbsp;</p>';
        const cedulas = e(m.cedulas || '').replace(/\n/g, '<br>');
        return '<article style="font-family:Arial,sans-serif;color:#000;width:100%;max-width:19.5cm;margin:0 auto;font-size:12px;line-height:1.35;display:flex;flex-direction:column;min-height:21cm;box-sizing:border-box;">'
            + '<header><div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:start;gap:8px;">'
            + '<div></div><div style="text-align:center;"><div style="font-size:20px;font-weight:bold;letter-spacing:.12em;">SANATORIO BELÉN</div>'
            + '<div style="margin-top:6px;font-weight:bold;">' + e(m.medico || '') + '</div>'
            + '<div style="font-size:11px;">' + e(m.especialidad || '') + '</div>'
            + '<div style="font-size:10px;white-space:pre-line;margin-top:2px;">' + e(m.cedulas || '') + '</div></div>'
            + '<div style="text-align:right;font-size:11px;"><div><strong>Folio:</strong> ' + e(m.folio || '') + '</div><div><strong>Exp:</strong> ' + e(m.expediente || '') + '</div></div></div>'
            + '<div style="margin-top:14px;">'
            + '<div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:8px;"><span style="flex:1;">' + dato('Nombre del Paciente:', m.paciente, '68%') + '</span><span>' + dato('Fecha:', m.fecha, '120px') + '</span></div>'
            + '<div style="display:flex;flex-wrap:wrap;gap:8px 14px;margin-bottom:8px;">' + dato('Fecha de Nacimiento:', m.fecha_nacimiento, '150px') + dato('Edad:', m.edad, '72px') + dato('Peso:', m.peso, '72px') + dato('Talla:', m.talla, '72px') + '</div>'
            + '<div>' + dato('Alergias:', m.alergias, '80%') + '</div></div></header>'
            + '<div style="position:relative;flex:1;min-height:10cm;margin-top:16px;">' + marcaAguaReceta() + '<div style="position:relative;">' + meds + '</div></div>'
            + '<footer style="margin-top:18px;"><div style="text-align:center;margin-bottom:12px;"><div style="display:inline-block;min-width:260px;border-top:1px solid #000;padding-top:4px;font-size:11px;"><strong>' + e(m.medico || '') + '</strong><br>' + cedulas + '</div></div>'
            + '<div style="background:#d7eefb;text-align:center;font-size:10px;padding:8px 10px;color:#0f172a;-webkit-print-color-adjust:exact;print-color-adjust:exact;">Josefa Ortiz de Domínguez 189, Col. Centro Pitillal, Puerto Vallarta, Jalisco. <br> Tel: 322 224 0564  WhatsApp: 322 174 2776  Cel: ___________________.</div>'
            + '</footer></article>';
    }
    function modeloRecetaOficial(receta) {
        const pac = receta.paciente_id ? buscarPacientePorId(receta.paciente_id) : null;
        const turno = receta.turno_id ? obtenerTurno(receta.turno_id) : null;
        const internamiento = (receta.internamiento_id && obtenerInternamiento(receta.internamiento_id)) || (turno && internamientoDeTurno(turno.turno_id));
        const medico = (receta.medico_id && USUARIOS[receta.medico_id]) || null;
        const esp = medico && especialidadPorCodigo(medico.especialidad_codigo);
        const sv = (turno && turno.signos_vitales) || {};
        const fn = (pac && pac.fecha_nacimiento) || receta.paciente_fecha_nacimiento || '';
        const edadN = (receta.paciente_edad !== null && receta.paciente_edad !== undefined && receta.paciente_edad !== '') ? receta.paciente_edad : (fn ? calcularEdad(fn) : null);
        const peso = (receta.paciente_peso !== '' && receta.paciente_peso != null) ? receta.paciente_peso : (sv.peso_kg != null ? sv.peso_kg : '');
        const talla = (receta.paciente_talla !== '' && receta.paciente_talla != null) ? receta.paciente_talla : (sv.talla_m != null ? sv.talla_m : '');
        return {
            folio: receta.folio || '',
            expediente: receta.paciente_id || '',
            medico: receta.medico_nombre || (medico && medico.nombre) || '',
            especialidad: receta.medico_especialidad || (esp && esp.nombre) || (medico && medico.cargo) || '',
            cedulas: receta.cedulas_impresas || textoCedulasFirma(medico),
            paciente: (pac && pac.nombre_completo) || receta.paciente_nombre || '',
            fecha: fechaHoraLegible(receta.fecha_hora),
            fecha_nacimiento: fn ? fechaLegibleISO(fn) : '',
            edad: (edadN === null || edadN === undefined || edadN === '') ? '' : (String(edadN).indexOf('año') >= 0 ? String(edadN) : (edadN + ' años')),
            peso: conUnidadReceta(peso, 'kg', 'kg'),
            talla: conUnidadReceta(talla, 'm', 'm'),
            alergias: receta.paciente_alergias || (internamiento && internamiento.alergias) || '',
            medicamentos: (receta.items || []).map(i => ({
                nombre: i.nombre || '',
                presentacion: [i.concentracion, nombreFormaFarmaceutica(i.forma_farmaceutica) || i.forma_farmaceutica].filter(Boolean).join(' · '),
                cantidad: i.cantidad_prescrita != null ? i.cantidad_prescrita : (i.cantidad || ''),
                instrucciones: i.dosis_indicacion || ''
            }))
        };
    }
    function htmlCuerpoReceta(op) {
        const d = datosReceta(op || {});
        const extra = [];
        if (d.lote) extra.push('Lote: ' + d.lote);
        if (d.laboratorio) extra.push('Laboratorio: ' + d.laboratorio);
        if (d.etiqueta) extra.push(d.etiqueta);
        if (d.numero) extra.push('Receta individual ' + d.numero + ' de ' + d.de + (d.folio_receta_especial ? '. Receta especial ' + d.folio_receta_especial : ''));
        if (d.datos_postanestesicos) extra.push(d.datos_postanestesicos);
        if (d.cama) extra.push('Cama/Habitación: ' + d.cama);
        const instrucciones = [d.dosis || '', extra.join(' · ')].filter(Boolean).join('\n');
        return htmlRecetaCarta({
            folio: d.folio_sistema || d.folio_receta_especial || '',
            expediente: d.expediente || '',
            medico: d.medico || '',
            especialidad: d.especialidad || '',
            cedulas: d.cedulas_texto || (d.cedula ? ('Cédula: ' + d.cedula) : ''),
            paciente: d.paciente || '',
            fecha: fechaHoraLegible(d.fecha),
            fecha_nacimiento: d.fecha_nacimiento || '',
            edad: d.edad || '',
            peso: conUnidadReceta(d.peso, 'kg', 'kg'),
            talla: conUnidadReceta(d.talla, 'm', 'm'),
            alergias: d.alergias || '',
            medicamentos: [{
                nombre: d.denominacion || '',
                presentacion: d.presentacion || '',
                cantidad: d.cantidad || '',
                instrucciones: instrucciones
            }]
        });
    }
    function htmlRecetaImprimible(op) {
        return '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Receta</title></head><body style="margin:32px">' + htmlCuerpoReceta(op) + '</body></html>';
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
            { lote_id: 'LOT-MID-1', sku: 'MID-5', nombre: 'Midazolam 5 mg', lote: 'L-MID-26A', caducidad: isoMasDias(400), stock: 20, precio_unitario: 40 },
            { lote_id: 'LOT-PRO-1', sku: 'PRO-200', nombre: 'Propofol 200 mg / 20 ml', lote: 'L-PRO-26A', caducidad: isoMasDias(300), stock: 20, precio_unitario: 95 },
            { lote_id: 'LOT-BUP-1', sku: 'BUP-05', nombre: 'Bupivacaína 0.5%', lote: 'L-BUP-26A', caducidad: isoMasDias(400), stock: 20, precio_unitario: 55 },
            { lote_id: 'LOT-DIA-1', sku: 'DIA-10', nombre: 'Diazepam 10 mg', lote: 'L-DIA-26A', caducidad: isoMasDias(300), stock: 12, precio_unitario: 35 },
            { lote_id: 'LOT-GUA-1', sku: 'GUA-M', nombre: 'Guantes de látex talla M', lote: 'L-GUA-26A', caducidad: isoMasDias(700), stock: 40, precio_unitario: 8 },
            { lote_id: 'LOT-JER-1', sku: 'JER-10', nombre: 'Jeringa 10 ml', lote: 'L-JER-26A', caducidad: isoMasDias(700), stock: 50, precio_unitario: 6 },
            { lote_id: 'LOT-VEN-1', sku: 'VEN-18', nombre: 'Equipo de venoclisis', lote: 'L-VEN-26A', caducidad: isoMasDias(500), stock: 20, precio_unitario: 45 },
            { lote_id: 'LOT-PUN-1', sku: 'PUN-18', nombre: 'Punzocat 18G', lote: 'L-PUN-26A', caducidad: isoMasDias(500), stock: 30, precio_unitario: 18 },
            { lote_id: 'LOT-CUR-1', sku: 'CUR-01', nombre: 'Gasas y material de curación', lote: 'L-CUR-26E', caducidad: isoMasDias(90), stock: 15, precio_unitario: 150 },
            { lote_id: 'LOT-MAT-1', sku: 'MAT-01', nombre: 'Material de curación', lote: 'L-MAT-26F', caducidad: isoMasDias(60), stock: 12, precio_unitario: 90 },
            { lote_id: 'LOT-SUT-1', sku: 'SUT-01', nombre: 'Material de sutura', lote: 'L-SUT-26G', caducidad: isoMasDias(120), stock: 8, precio_unitario: 210 }
        ].map(completarLote);
    }
    function semillaPaquetesFarmacia() {
        return [
            { paquete_id: 'PAQ-CESAREA', nombre: 'Paquete Cesárea', items: [
                { sku: 'GUA-M', cantidad: 2 }, { sku: 'JER-10', cantidad: 4 }, { sku: 'VEN-18', cantidad: 1 }, { sku: 'PUN-18', cantidad: 2 },
                { sku: 'CEF-1G', cantidad: 1 }, { sku: 'SOL-1000', cantidad: 1 }, { sku: 'BH', cantidad: 1 }, { sku: 'EKG', cantidad: 1 }
            ] },
            { paquete_id: 'PAQ-COLE', nombre: 'Paquete Colecistectomía', items: [
                { sku: 'GUA-M', cantidad: 2 }, { sku: 'JER-10', cantidad: 3 }, { sku: 'VEN-18', cantidad: 1 }, { sku: 'PUN-18', cantidad: 1 },
                { sku: 'CEF-1G', cantidad: 1 }, { sku: 'SOL-1000', cantidad: 2 }, { sku: 'SUT-01', cantidad: 1 }, { sku: 'EKG', cantidad: 1 }
            ] },
            { paquete_id: 'PAQ-PARTO', nombre: 'Paquete Parto', items: [
                { sku: 'GUA-M', cantidad: 2 }, { sku: 'VEN-18', cantidad: 1 }, { sku: 'JER-10', cantidad: 2 },
                { sku: 'DEX', cantidad: 1 }, { sku: 'BH', cantidad: 1 }, { sku: 'SOL-1000', cantidad: 1 }
            ] }
        ];
    }
    function semillaCajaFentanilo() {
        const lote = (listarFarmacia().find(p => p.lote_id === 'LOT-FEN-1')) || productoPorSku('FEN-50');
        if (!lote) return [];
        return [{
            caja_id: 'CAJA-FEN-1', sku: lote.sku, nombre: lote.nombre, lote_id: lote.lote_id, lote: lote.lote,
            piezas_por_caja: lote.piezas_por_caja || 5, usadas: 0, folio_receta_especial: 'RE-2026-0142',
            area_destino: 'QUIROFANO', caducidad: lote.caducidad,
            responsable_id: 'dra_elena', responsable_nombre: (USUARIOS.dra_elena || {}).nombre || 'Dra. Elena Ríos',
            creada_en: new Date().toISOString(), usos: []
        }];
    }
    function asegurarMedsAnestesia() {
        const extras = [
            { lote_id: 'LOT-MID-1', sku: 'MID-5', nombre: 'Midazolam 5 mg', lote: 'L-MID-26A', caducidad: isoMasDias(400), stock: 20, precio_unitario: 40 },
            { lote_id: 'LOT-PRO-1', sku: 'PRO-200', nombre: 'Propofol 200 mg / 20 ml', lote: 'L-PRO-26A', caducidad: isoMasDias(300), stock: 20, precio_unitario: 95 },
            { lote_id: 'LOT-BUP-1', sku: 'BUP-05', nombre: 'Bupivacaína 0.5%', lote: 'L-BUP-26A', caducidad: isoMasDias(400), stock: 20, precio_unitario: 55 }
        ].map(completarLote);
        const lista = listarFarmacia();
        let cambio = false;
        extras.forEach(extra => { if (!lista.some(p => p.lote_id === extra.lote_id)) { lista.push(extra); cambio = true; } });
        if (cambio) escribir(CLAVES.farmacia, lista);
    }
    function sembrarFarmaciaSiHaceFalta() {
        if (localStorage.getItem(CLAVES.surtido) === null) escribir(CLAVES.surtido, []);
        let lista = localStorage.getItem(CLAVES.farmacia) === null ? semillaLotesFarmacia() : listarFarmacia();
        if (localStorage.getItem(CLAVES.farmaciaAmpliada) === null) {
            semillaLotesFarmacia().forEach(extra => { if (!lista.some(p => p.lote_id === extra.lote_id)) lista.push(extra); });
            escribir(CLAVES.farmaciaAmpliada, true);
        }
        lista = lista.filter(p => !loteFueraDeAlmacen(p)).map(p => {
            if (String(p.sku || '').toUpperCase() === 'CUR-01' && normalizar(p.nombre) === 'curacion') p.nombre = 'Gasas y material de curación';
            return completarLote(p);
        });
        escribir(CLAVES.farmacia, lista);
        consolidarCatalogoEstudios();
        if (localStorage.getItem(CLAVES.paquetes) === null) escribir(CLAVES.paquetes, semillaPaquetesFarmacia());
        if (localStorage.getItem(CLAVES.cajasEstupefacientes) === null) escribir(CLAVES.cajasEstupefacientes, semillaCajaFentanilo());
        etiquetarAreaCajas();
        asegurarMedsAnestesia();
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
        if (localStorage.getItem(CLAVES.catalogo) !== null || localStorage.getItem(CLAVES.visitas) !== null) { sembrarCirugiasSiHaceFalta(); migrarCirugiasFase1(); sembrarPacienteQuirofanoDemo(); return false; }
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
        migrarCirugiasFase1();
        sembrarPacienteQuirofanoDemo();
        return true;
    }
    function sembrarPacienteQuirofanoDemo() {
        if (localStorage.getItem(CLAVES.demoQxActivo) === '1') return false;
        if (obtenerTurno('T-DEMO-QX') || listarInternamientos().some(i => i.internamiento_id === 'INT-DEMO-QX')) {
            localStorage.setItem(CLAVES.demoQxActivo, '1');
            return false;
        }
        const medico = USUARIOS.dr_arturo;
        const ana = USUARIOS.dra_elena;
        if (!medico || !ana) return false;
        const pid = 'PAC-DEMO-QX';
        const pacs = listarPacientes();
        if (!pacs.some(p => p.paciente_id === pid)) {
            pacs.push({
                paciente_id: pid, nombre_completo: 'Helena Vargas Ríos', fecha_nacimiento: '1976-05-18', sexo: 'F',
                estado_civil: 'Casada', telefono: '3221550190', ocupacion: 'Comerciante',
                direccion: 'Av. de los Deportes 88, Col. Fluvial', creado_en: new Date().toISOString()
            });
            if (!escribir(CLAVES.catalogo, pacs)) return false;
        }
        const preferida = resolverCama('REC-1');
        const libre = camasLibres('QUIROFANO');
        const cama = (preferida && !camaEstaOcupada(preferida, null)) ? preferida : (libre[0] ? resolverCama(libre[0].codigo) : null);
        const ahora = new Date();
        const cita = citaQuirurgica(0, ahora.getHours(), 0, 150);
        const esp = especialidadPorCodigo(medico.especialidad_codigo);
        const ahoraIso = new Date().toISOString();
        const turno = {
            turno_id: 'T-DEMO-QX', paciente_id: pid, paciente_nombre: 'Helena Vargas Ríos', fecha_nacimiento: '1976-05-18', sexo: 'F',
            especialidad_codigo: medico.especialidad_codigo, especialidad: esp ? esp.nombre : medico.cargo,
            medico_id: medico.medico_id || medico.id, medico_nombre: medico.nombre, motivo: 'Colecistectomía laparoscópica',
            fecha_turno: hoyLocal(), numero_turno: siguienteNumeroTurno(medico.especialidad_codigo), timestamp_llegada: ahoraIso,
            estatus: ESTATUS.INTERNADO, modalidad: MODALIDAD_AMBULATORIO_QX, sin_nota_consulta: true,
            area_destino: AREA_AMBULATORIO_QX, destino: 'Quirofano', signos_vitales: null, cargos: [], cuenta_actual: 0, cuenta_actual_total: 0,
            cirugia_id: 'CX-DEMO-QX', registrado_por: 'administrador', ordenes_aplicacion: []
        };
        if (!escribir(CLAVES.turnos, listarTurnos().concat([turno]))) return false;
        const hoja = nuevaHojaIndicaciones([], 'preoperatorio', {
            dieta: 'Ayuno. Líquidos claros al egreso si tolera.',
            soluciones_parenterales: 'Solución fisiológica 1000 ml para venoclisis.',
            medicamentos: 'Ceftriaxona 1 g IV cada 12 horas. Midazolam 5 mg IV en caso de agitación.',
            medidas_generales: 'Recuperación en REC. Control de sangrado y dolor. Avisar al cirujano si hay náusea persistente.'
        }, { id: medico.id, nombre: medico.nombre, relacion: 'tratante' }, ahoraIso);
        anotarCoberturaIndicacion(hoja);
        const internamiento = {
            internamiento_id: 'INT-DEMO-QX', turno_id: turno.turno_id, paciente_id: pid,
            medico_tratante_id: medico.medico_id || medico.id, medico_tratante_nombre: medico.nombre,
            especialidad_codigo: medico.especialidad_codigo, especialidad: turno.especialidad,
            fecha_ingreso: ahoraIso, cama: cama ? cama.nombre : null, cama_codigo: cama ? cama.codigo : null,
            estatus: 'activo', modalidad: MODALIDAD_AMBULATORIO_QX, sin_nota_consulta: true,
            hoja_frontal_habilitada: true, consentimientos_habilitados: true,
            area_destino: AREA_AMBULATORIO_QX, area_codigo: 'QUIROFANO', destino: 'Quirofano',
            diagnostico_ingreso: 'Colelitiasis. Colecistectomía laparoscópica.', diagnostico_actual: 'Colelitiasis. Colecistectomía laparoscópica.', alergias: 'Ninguna conocida',
            interconsultas: [], notas_evolucion: [], hojas_indicaciones: [hoja], cargos: [], cuenta_actual: 0, cuenta_actual_total: 0,
            nota_egreso: null, cirugia_id: 'CX-DEMO-QX',
            ubicacion: UBICACION_QX.QUIROFANO, cama_origen_piso: null,
            notas_postanestesicas: [], notas_postoperatorias: [], recetas_controlados: []
        };
        if (!guardarInternamiento(internamiento)) return false;
        const cirugias = listarCirugias().filter(c => c.cirugia_id !== 'CX-DEMO-QX');
        cirugias.push(Object.assign({
            cirugia_id: 'CX-DEMO-QX', paciente_id: pid, paciente_nombre: 'Helena Vargas Ríos', fecha_nacimiento: '1976-05-18',
            procedimiento: 'Colecistectomía laparoscópica', medico_cirujano_id: medico.id, medico_cirujano_nombre: medico.nombre,
            anestesiologo_id: ana.id, anestesiologo_nombre: ana.nombre,
            sala: 'QX_CHICO', tipo_estancia: 'AMBULATORIA',
            indicaciones_preoperatorias: 'Ayuno. Profilaxis con ceftriaxona. Recuperación en cama de quirófano.',
            notas: 'Paciente de ejemplo ya ingresada en recuperación. Lista para abrir el expediente.',
            estatus: 'programada', programada_por_id: 'administrador', programada_por_nombre: (USUARIOS.administrador || {}).nombre || 'Adm. Sofía',
            creado_en: ahoraIso, turno_id: turno.turno_id, internamiento_id: internamiento.internamiento_id, ingresado_en: ahoraIso
        }, cita));
        if (!escribir(CLAVES.cirugias, cirugias)) return false;
        localStorage.setItem(CLAVES.demoQxActivo, '1');
        return true;
    }

    function prefillHojaQuirurgica(turnoId) {
        const t = obtenerTurno(turnoId) || {};
        const i = t.turno_id ? internamientoDeTurno(t.turno_id) : null;
        const p = t.paciente_id ? (buscarPacientePorId(t.paciente_id) || {}) : {};
        const cir = ((i && i.cirugia_id) ? listarCirugias().find(c => c.cirugia_id === i.cirugia_id) : null)
            || listarCirugias().find(c => c.turno_id === t.turno_id) || {};
        const fn = p.fecha_nacimiento || t.fecha_nacimiento || '';
        const edad = fn ? calcularEdad(fn) : null;
        const sexo = (p.sexo || t.sexo) === 'F' ? 'Femenino' : ((p.sexo || t.sexo) === 'M' ? 'Masculino' : '');
        const cama = i ? etiquetaCama(i.cama_codigo || i.cama) : (t.cama ? etiquetaCama(t.cama_codigo || t.cama) : '');
        return {
            expediente: t.paciente_id || p.paciente_id || '',
            nombre: p.nombre_completo || t.paciente_nombre || '',
            edad: edad === null || edad === undefined ? '' : (edad + (edad === 1 ? ' año' : ' años')),
            sexo: sexo,
            servicio: (i && (i.area_destino || nombreAreaEstancia(i.area_codigo))) || t.area_destino || '',
            cama: cama || '',
            fecha_programacion: cir.fecha ? fechaLegibleISO(cir.fecha) : (cir.fecha_hora ? fechaHoraLegible(cir.fecha_hora) : ''),
            dx_pre: (i && (i.diagnostico_ingreso || i.diagnostico_actual)) || t.dx_principal || '',
            operacion: cir.procedimiento || '',
            fecha_hora_quirurgica: cir.fecha_hora ? fechaHoraLegible(cir.fecha_hora) : '',
            cirujano: cir.medico_cirujano_nombre || (i && i.medico_tratante_nombre) || t.medico_nombre || '',
            anestesiologo: cir.anestesiologo_nombre || '',
            medico: (i && i.medico_tratante_nombre) || t.medico_nombre || ''
        };
    }
    function leerNotaPostoperatoria(raiz) {
        const q = sel => raiz && raiz.querySelector(sel);
        const val = sel => (q(sel) && q(sel).value) || '';
        const si = val('#po-patologia') === 'si';
        const pron = limpiarEspacios(val('#po-pronostico'));
        return {
            entrada: true, pausa: true, salida: true, conteo: true,
            dx_pre: val('#po-dxpre'), dx_post: val('#po-dxpost'), operacion: val('#po-op'),
            tecnica: val('#po-tecnica'), hallazgos: val('#po-hallazgos'),
            sangrado_ml: val('#po-sangrado'), patologia: val('#po-patologia') || 'no',
            pronostico: pron || 'Reservado a evolución',
            estudio_biopsia_id: si ? val('#po-estudio') : '',
            cargar_biopsia: !!(si && q('#po-cargar') && q('#po-cargar').checked),
            servicio: val('#po-servicio'), fecha_programacion: val('#po-fprog'),
            fecha_hora_quirurgica: val('#po-fhq'), recuento: val('#po-recuento'),
            uresis: val('#po-uresis'), tipo_anestesia: val('#po-anestesia'),
            cirujano: val('#po-cirujano'), ayudante: val('#po-ayudante'),
            anestesiologo: val('#po-anestesiologo'), instrumentista: val('#po-instrumentista'),
            circulante: val('#po-circulante'), otro: val('#po-otro')
        };
    }
    function htmlModalHojaQuirurgica(prefill) {
        const p = prefill || {};
        const e = escHtmlCuenta;
        const cls = 'w-full border border-slate-300 rounded-lg p-2 text-sm bg-white';
        const lab = (t, id) => '<label class="block text-[11px] font-bold text-slate-500 uppercase mb-1" for="' + id + '">' + t + '</label>';
        const biopsias = listarEstudios().filter(est => est.categoria === 'PATOLOGIA' || normalizar(est.nombre).indexOf('biopsia') >= 0);
        const opts = biopsias.length
            ? biopsias.map(b => '<option value="' + e(b.estudio_id) + '">' + e(b.nombre) + ' · ' + e(formatoMoneda(b.precio_unitario)) + '</option>').join('')
            : '<option value="">Sin estudios de patología en el catálogo</option>';
        return '<div class="space-y-3 text-left text-sm text-slate-800">'
            + '<p class="text-center font-extrabold tracking-wide">HOJA QUIRÚRGICA</p>'
            + '<p class="text-[11px] text-right text-slate-500">Exp: <b>' + e(p.expediente || '') + '</b> · Cama/Habitación: <b>' + e(p.cama || 'Por asignar por Enfermería') + '</b></p>'
            + '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">'
            + '<div>' + lab('SERVICIO', 'po-servicio') + '<input id="po-servicio" class="' + cls + '" value="' + e(p.servicio || '') + '"></div>'
            + '<div>' + lab('FECHA DE PROGRAMACIÓN', 'po-fprog') + '<input id="po-fprog" class="' + cls + '" value="' + e(p.fecha_programacion || '') + '"></div></div>'
            + '<div class="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs">'
            + '<p><b>Nombre del/la paciente:</b><br>' + e(p.nombre || '') + '</p>'
            + '<p><b>Edad:</b><br>' + e(p.edad || '') + '</p>'
            + '<p><b>Sexo:</b><br>' + e(p.sexo || '') + '</p></div>'
            + '<div>' + lab('Dx Preoperatorio', 'po-dxpre') + '<input id="po-dxpre" class="' + cls + '" value="' + e(p.dx_pre || '') + '"></div>'
            + '<p class="text-xs text-justify leading-relaxed border border-slate-200 rounded-lg p-3">Autorizo al/el médico tratante que labora en <b><i>SANATORIO BELÉN S.A. de C.V.</i></b>, para que efectúe la(s) intervención(es) quirúrgica(s) que sea(n) necesaria(s) para el tratamiento y curación de mi padecimiento/enfermedad, entiendo y acepto que me han informado correcta y comprensiblemente todos los posibles riesgos a los que quedo sujeta/o por el procedimiento anestésico, quirúrgico y por los medicamentos que me sean aplicados, antes, durante y después de realizar el procedimiento quirúrgico.</p>'
            + '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-center">'
            + '<div class="border-t border-slate-400 pt-2">Nombre y firma del Paciente</div><div class="border-t border-slate-400 pt-2">Nombre y firma del familiar/testigo</div></div>'
            + '<div>' + lab('Operación Programada', 'po-op') + '<input id="po-op" class="' + cls + '" value="' + e(p.operacion || '') + '"></div>'
            + '<div>' + lab('Fecha y hora quirúrgica', 'po-fhq') + '<input id="po-fhq" class="' + cls + '" value="' + e(p.fecha_hora_quirurgica || '') + '"></div>'
            + '<div>' + lab('Técnica Quirúrgica', 'po-tecnica') + '<textarea id="po-tecnica" rows="3" class="' + cls + '"></textarea></div>'
            + '<div>' + lab('Hallazgos', 'po-hallazgos') + '<textarea id="po-hallazgos" rows="3" class="' + cls + '"></textarea></div>'
            + '<div>' + lab('Recuento de material médico y quirúrgico', 'po-recuento') + '<textarea id="po-recuento" rows="2" class="' + cls + '"></textarea></div>'
            + '<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">'
            + '<div>' + lab('Sangrado (ml)', 'po-sangrado') + '<input id="po-sangrado" type="number" min="0" value="0" class="' + cls + '"></div>'
            + '<div>' + lab('Uresis', 'po-uresis') + '<input id="po-uresis" class="' + cls + '"></div>'
            + '<div>' + lab('Tipo de Anestesia', 'po-anestesia') + '<input id="po-anestesia" class="' + cls + '"></div></div>'
            + '<div>' + lab('Dx Postoperatorio', 'po-dxpost') + '<input id="po-dxpost" class="' + cls + '"></div>'
            + '<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">'
            + '<div>' + lab('Cirujana/o', 'po-cirujano') + '<input id="po-cirujano" class="' + cls + '" value="' + e(p.cirujano || '') + '"></div>'
            + '<div>' + lab('Ayudante', 'po-ayudante') + '<input id="po-ayudante" class="' + cls + '"></div>'
            + '<div>' + lab('Anestesióloga/o', 'po-anestesiologo') + '<input id="po-anestesiologo" class="' + cls + '" value="' + e(p.anestesiologo || '') + '"></div>'
            + '<div>' + lab('Instrumentista', 'po-instrumentista') + '<input id="po-instrumentista" class="' + cls + '"></div>'
            + '<div>' + lab('Circulante', 'po-circulante') + '<input id="po-circulante" class="' + cls + '"></div>'
            + '<div>' + lab('Otra/o', 'po-otro') + '<input id="po-otro" class="' + cls + '"></div></div>'
            + '<div class="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">'
            + '<p class="text-[11px] font-bold uppercase text-slate-500">Registro electrónico complementario</p>'
            + '<div>' + lab('Pronóstico', 'po-pronostico') + '<input id="po-pronostico" class="' + cls + '" placeholder="Reservado a evolución"></div>'
            + '<div>' + lab('Pieza enviada a patología', 'po-patologia') + '<select id="po-patologia" class="' + cls + '" onchange="var bx=document.getElementById(\'po-bx\'); if(bx) bx.classList.toggle(\'hidden\', this.value!==\'si\')"><option value="no">No</option><option value="si">Sí</option></select></div>'
            + '<div id="po-bx" class="hidden space-y-2">' + lab('Estudio de biopsia del catálogo', 'po-estudio') + '<select id="po-estudio" class="' + cls + '">' + opts + '</select>'
            + '<label class="flex items-center gap-2 text-xs font-semibold"><input id="po-cargar" type="checkbox" checked class="rounded"> Cargar estudio de Biopsia automáticamente a la cuenta del paciente</label></div></div>'
            + '<p id="po-error" class="text-xs text-red-600 hidden"></p></div>';
    }
    function htmlHojaQuirurgica(nota, ficha) {
        const e = escHtmlCuenta;
        const n = nota || {};
        const f = ficha || {};
        const firm = n.firmantes || {};
        const txt = (a, b) => {
            if (a !== undefined && a !== null && String(a).trim() !== '') return String(a);
            return b ? String(b) : '';
        };
        const linea = (et, val) => '<p style="margin:2px 0;"><strong>' + et + ':</strong> ' + e(val || '') + '</p>';
        const firma = (et, nombre) => '<div style="width:31%;text-align:center;font-size:9px;margin-top:22px;"><div style="min-height:16px;font-weight:bold;">' + e(nombre || '') + '</div><div style="border-top:1px solid #000;padding-top:3px;">' + et + '</div></div>';
        const cama = txt(f.cama, '') || 'Por asignar por Enfermería';
        const sangrado = (n.sangrado_ml !== undefined && n.sangrado_ml !== null && n.sangrado_ml !== '') ? (n.sangrado_ml + ' ml') : '';
        return '<article style="font-family:Arial,sans-serif;font-size:11px;color:#000;line-height:1.35;">'
            + '<p style="text-align:right;margin:0 0 4px;"><strong>Exp:</strong> ' + e(txt(f.expediente, '')) + ' &nbsp; <strong>No. de Cama/Habitación:</strong> ' + e(cama) + '</p>'
            + '<p style="margin:0 0 8px;"><strong>SERVICIO:</strong> ' + e(txt(n.servicio, f.servicio)) + '. &nbsp;&nbsp; <strong>FECHA DE PROGRAMACIÓN:</strong> ' + e(txt(n.fecha_programacion, f.fecha_programacion)) + '.</p>'
            + '<p style="margin:2px 0;">Nombre del/la paciente: ' + e(txt(f.nombre, '')) + '. &nbsp; Edad: ' + e(txt(f.edad, '')) + '. &nbsp; Sexo: ' + e(txt(f.sexo, '')) + '.</p>'
            + '<p style="margin:2px 0;">Dx Preoperatorio: ' + e(txt(n.dx_pre, f.dx_pre)) + '.</p>'
            + '<p style="text-align:justify;margin:8px 0;">Autorizo al/el médico tratante que labora en <strong><em>SANATORIO BELÉN S.A. de C.V.</em></strong>, para que efectúe la(s) intervención(es) quirúrgica(s) que sea(n) necesaria(s) para el tratamiento y curación de mi padecimiento/enfermedad, entiendo y acepto que me han informado correcta y comprensiblemente todos los posibles riesgos a los que quedo sujeta/o por el procedimiento anestésico, quirúrgico y por los medicamentos que me sean aplicados, antes, durante y después de realizar el procedimiento quirúrgico.</p>'
            + '<div style="display:flex;justify-content:space-between;gap:16px;margin:22px 0 10px;">'
            + '<div style="width:42%;text-align:center;font-size:10px;border-top:1px solid #000;padding-top:3px;">Nombre y firma del Paciente</div>'
            + '<div style="width:42%;text-align:center;font-size:10px;border-top:1px solid #000;padding-top:3px;">Nombre y firma del familiar/testigo</div></div>'
            + linea('Operación Programada', txt(n.operacion, f.operacion))
            + linea('Fecha y hora quirúrgica', txt(n.fecha_hora_quirurgica, f.fecha_hora_quirurgica))
            + '<p style="margin:8px 0 2px;text-align:center;"><strong>Técnica Quirúrgica:</strong></p><div style="white-space:pre-wrap;min-height:48px;border-bottom:1px solid #000;margin:0 0 8px;">' + e(txt(n.tecnica, '')) + '</div>'
            + '<p style="margin:8px 0 2px;text-align:center;"><strong>Hallazgos:</strong></p><div style="white-space:pre-wrap;min-height:48px;border-bottom:1px solid #000;margin:0 0 8px;">' + e(txt(n.hallazgos, '')) + '</div>'
            + linea('Recuento de material médico y quirúrgico', txt(n.recuento, ''))
            + linea('Sangrado', sangrado)
            + linea('Uresis', txt(n.uresis, ''))
            + linea('Tipo de Anestesia', txt(n.tipo_anestesia, ''))
            + linea('Dx Postoperatorio', txt(n.dx_post, ''))
            + linea('Cirujana/o', txt(firm.cirujano, f.cirujano))
            + linea('Ayudante', txt(firm.ayudante, ''))
            + linea('Anestesióloga/o', txt(firm.anestesiologo, f.anestesiologo))
            + linea('Instrumentista', txt(firm.instrumentista, ''))
            + linea('Circulante', txt(firm.circulante, ''))
            + linea('Otra/o', txt(firm.otro, ''))
            + '<div style="display:flex;flex-wrap:wrap;justify-content:space-between;">'
            + firma('Firma del Cirujana/o', '')
            + firma('Firma del Ayudante', '')
            + firma('Firma del Anestesióloga/o', '')
            + firma('Firma del Instrumentista', '')
            + firma('Firma del Circulante', '')
            + firma('Firma Otra/o', '')
            + '</div></article>';
    }

    // Borra TODA la información operativa del demo (no toca los machotes) y vuelve a sembrar
    function restablecerDemo() {
        [CLAVES.catalogo, CLAVES.turnos, CLAVES.visitas, CLAVES.borradores, CLAVES.hospitalizados, CLAVES.internamientos, CLAVES.correcciones, CLAVES.cirugias, CLAVES.farmacia, CLAVES.estudios, CLAVES.estudiosV3, CLAVES.surtido, CLAVES.paquetes, CLAVES.cajasEstupefacientes, CLAVES.salidasFarmacia, CLAVES.movimientosFarmacia, CLAVES.recetasFoliadas, CLAVES.recetas, CLAVES.folioRecetaSeq, CLAVES.folioExternoSeq, CLAVES.demoQxActivo, CLAVES.ivaDiferido, CLAVES.farmaciaAmpliada, CLAVES.demo].forEach(k => localStorage.removeItem(k));   // los interruptores de personal se conservan
        return sembrarDemoSiHaceFalta();
    }

    global.BelenStore = {
        CLAVES, ESPECIALIDADES, ROLES, ENFERMERIAS, PERSONAL_OPERATIVO, USUARIOS, COLORES_DISTINTIVO, ACCIONES_PERSONAL, PERMISOS, MODULOS, ESTATUS, ETIQUETA_ESTATUS, ESTATUS_EN_FILA, RANGOS_SIGNOS, SIGNOS_OBLIGATORIOS,
        SALAS_QUIROFANO, DURACIONES_CIRUGIA, TIPOS_ESTANCIA_QX, ESPECIALIDADES_QUIRURGICAS, QX_DIA_INICIO, QX_DIA_FIN, AREA_AMBULATORIO_QX, MODALIDAD_AMBULATORIO_QX,
        CAMAS_HOSPITAL, QX_TRASLADO_MINUTOS, TECNICAS_ANESTESIA, MEDS_ANESTESIA, UBICACION_QX,
        leer, escribir, normalizar, limpiarEspacios, hoyLocal, parseFechaISO, calcularEdad, fechaLegibleISO, iniciales, formatoReloj, hashContrasena, colorDeUsuario,
        iniciarSesion, sesion, cerrarSesion, puede, esEnfermeria, moduloAplicaARol, permisoModuloDe, permisoModuloExplicito, establecerPermisoModulo, permisoAccionDe, establecerPermisoAccion, restablecerPermisosPersonal, leerPermisosPersonal, especialidadPorCodigo, medicosDeEspecialidad, identificarOperadorFarmacia,
        guardarUsuario, desactivarUsuario, reactivarUsuario, eliminarUsuario, listarPapeleria, agregarDocumentoPersonal, eliminarDocumentoPersonal,
        listarPacientes, buscarPacientePorIdentidad, buscarPacientesPorNombre, buscarPacientePorId, homonimos, guardarPaciente, partesDeNombre, fusionarExpedientes,
        listarTurnos, obtenerTurno, actualizarTurno, siguienteNumeroTurno, crearTurno, ordenarPorLlegada, turnoVisiblePara, filaDe, colaEspera, pacientesEnConsulta, posicionEnCola, posicionNuevaEnCola, siguienteEnCola, corteDiario, metricas24h,
        listarCirugias, fichaCirugia, proximasCirugias, cirugiasVisibles, cirugiaVisiblePara, cirugiaPara, cirujanos, anestesiologos, disponibilidadQuirofano, validarCirugia, programarCirugia, asignarAnestesiologo, puedeIngresarAmbulatorio, ingresarPacienteAmbulatorio, hospitalizadosDe, hospitalizadoVisiblePara,
        camasLibres, flujoQuirofanoDe, pasarPacienteAQuirofano, recibirEnQuirofano, regresarAHospitalizacion, datosHojaTransanestesica,
        guardarNotaPostanestesica, guardarNotaPostoperatoria, prefillHojaQuirurgica, htmlModalHojaQuirurgica, leerNotaPostoperatoria, htmlHojaQuirurgica, altaAmbulatoriaQx, convertirAmbulatorioAPiso,
        puedeImprimirHojaTrans, puedeNotaPostanestesica, puedeNotaPostoperatoria, puedeAltaAmbulatoria, puedeConvertirAPiso, puedeRegresarAPiso,
        validarSignos, signosCompletos, resumenSignos, guardarSignos,
        pasarAMedico, iniciarConsulta, accesoExpediente,
        leerBorrador, guardarBorrador, borrarBorrador,
        listarVisitas, registrarVisita, visitasDePaciente, piezasClinicasPaciente, antecedentesLongitudinales,
        CEDULAS_FIRMA, esMedicoGeneral, lineasCedulaFirma, textoCedulasFirma, resumenCedulas, guardarCedulasVisibles,
        listarHospitalizados, guardarHospitalizado,
        listarInternamientos, internamientoDeTurno, obtenerInternamiento, resolverInternamiento, asegurarInternamiento, sincronizarInternamiento, descartarInternamiento,
        fichaHospitalizado, accesoVisorHospitalizado, relacionMedico, tieneInterconsulta, medicosParaInterconsulta, solicitarInterconsulta,
        validarNotaEvolucion, agregarNotaEvolucion, indicacionesVigentes, agregarHojaIndicaciones, asignarCama,
        etiquetaCama, codigoAreaEstancia, areasDestinoEstancia, nombreAreaEstancia, puedeCambiarArea, cambiarAreaEstancia, previewCorteEstancia, aplicarCorteEstancia,
        CONCEPTOS_HOSPITAL, CONCEPTOS_AMBULATORIO, formatoMoneda, validarCargo, puedeCargarConsumos, desgloseFiscal, sugerirIvaConcepto,
        agregarCargoInternamiento, agregarCargoTurno, validarNotaEgreso, registrarEgreso,
        cargosDeEpisodio, cuentasPorCobrar, fichaCuenta, cerrarExpedientePagado,
        listarInventarioFarmacia, productoPorSku, buscarLotesFarmacia, validarIngresoFarmacia, ingresarInsumo, actualizarInsumo, fichasSurtidoPendiente, surtirLinea, parsearLineasSurtido,
        CATEGORIAS_FARMACIA, CATEGORIAS_ALMACEN, FRACCIONES_COFEPRIS, CLASIFICACION_AWARE, FORMAS_FARMACEUTICAS, VIAS_ADMINISTRACION, CONSERVACIONES, LABORATORIOS_FRECUENTES, TIPOS_ESTUDIO, RECIPIENTES_MUESTRA, MODOS_IVA,
        nombreCategoriaFarmacia, nombreFraccionCofepris, nombreFormaFarmaceutica, nombreConservacion, textoStockFarmacia, denominacionProducto, etiquetaNormativa, badgeRecetaMedica, puedeEmitirRecetaMedica,
        listarEstudios, estudiosPorCategoria, estudioPorCodigo, guardarEstudio, eliminarEstudio, cargarEstudioACuenta, cargarEstudiosACuenta, nombreTipoEstudio,
        resumenTubosEstudios, puedeGestionarTarifario, puedeAlterarMontoEstudio, puedeAjustarCuenta, episodioAbiertoParaEstudios, turnoActivoParaEstudios,
        cuentasAuditoria, establecerFacturaCuenta, establecerFiscalCuenta, fiscalDeTurno, ajustarLineaCuenta, htmlEstadoCuenta, metaCargoCuenta,
        listarPaquetes, guardarPaquete, eliminarPaquete, lineasDePaquete, sumaRealPaquete, aplicarPaqueteAPaciente,
        enfermerasActivas, pacientesTerminalFarmacia, prepararLineaCarrito, loteMasProximo, lotesVigentesDeSku, confirmarCarritoFarmacia,
        cajasAbiertasDe, restantesCaja, etiquetaCajaAbierta, abrirCajaEstupefaciente, dispensarAmpulas, listarCajas, listarCajasEstupefacientes, AREAS_CAJA, nombreAreaCaja, areaResguardoDeSesion, areaResguardoDeTurno, cajasDeArea, usarAmpulaDesdeNota,
        listarSalidasFarmacia, registrarRetiroAdministracion, filtrarMovimientosFarmacia, personasBitacora, presentacionesBitacora, lotesDePresentacion, presentacionMovimiento, awareDeMovimiento, carpetasMovimientosFarmacia, csvMovimientosFarmacia, alertasCofeprisEnTexto, medicamentosDetectadosEnTexto,
        listarRecetas, recetaPorFolio, recetasDeTurno, recetasDePaciente, buscarMedicamentosReceta, emitirReceta, enviarOrdenAplicacion, guardarBorradorRecetaCasa, modificarRecetaPendiente, cancelarRecetaConsulta, registrarSurtidoReceta, htmlHojaReceta, etiquetaEstatusReceta,
        respaldoParaSurtido, lineasSugeridasDeReceta, loteParaSurtir, textoSurtidoItem, textoEstatusBitacora, inferirTipoRespaldo, cedulaDeUsuario, pendienteFolioSku, confirmarSurtidoMostrador,
        folioRecetaVigente, guardarRecetaFoliada, datosReceta, htmlCuerpoReceta, htmlRecetaImprimible,
        validarCorreccionPaciente, corregirDatosPaciente, fechaNacimientoParaEdad, fechaHoraLegible,
        sembrarDemoSiHaceFalta, restablecerDemo,
        devolverSalidaFarmacia, darBajaInsumoFarmacia, MOTIVOS_BAJA_FARMACIA, puedeDevolverFarmacia, listarMovimientosFarmacia,
        ampulasFraccionIPendientes, justificarAmpulasFraccionI, guardarNotaPreanestesica, guardarRegistroTransanestesico,
        puedeEditarSeccion, SECCIONES_QX_AMBULATORIO, sincronizarPaseAutomaticoQuirofano, listarCirugiasSincronizadas, listarInternamientosSincronizados,
        obtenerHojaEnfermeria, guardarHojaEnfermeria, TURNOS_ENFERMERIA
    };
    sembrarUsuariosSiHaceFalta();
    completarAnestesiologoCirugias();
    migrarCirugiasFase1();
    sembrarFarmaciaSiHaceFalta();
    normalizarIvaDiferido();
    sembrarPacienteQuirofanoDemo();
})(window);
