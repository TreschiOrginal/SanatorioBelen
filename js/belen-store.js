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
        { codigo: 'TRAUMATOLOGIA_ORTOPEDIA', nombre: 'Traumatología y Ortopedia' },
        { codigo: 'PEDIATRIA', nombre: 'Pediatría y Neonatología' },
        { codigo: 'PSICOLOGIA', nombre: 'Psicología Clínica' }
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
        { id: 'dr_internista', rol: 'medico',        nombre: 'Dr. Daniel Morales', cargo: 'Medicina Interna',               cedula_profesional: 'MI-5520',  cedula_general: '', cedula_especialidad: 'MI-5520', cedula_subespecialidad: '', cedulas_visibles: ['especialidad'], codigo_rapido: '5520', especialidad_codigo: 'MEDICINA_INTERNA',     costo_consulta: 800, color_distintivo: 'cyan',    etiqueta_admin: 'Internista' },
        { id: 'dra_elena',     rol: 'medico',        nombre: 'Dra. Elena Ríos',    cargo: 'Anestesiología',                 cedula_profesional: 'AE-45821', cedula_general: '', cedula_especialidad: 'AE-45821', cedula_subespecialidad: '', cedulas_visibles: ['especialidad'], codigo_rapido: '4582', especialidad_codigo: 'ANESTESIOLOGIA',       costo_consulta: 800, color_distintivo: 'rose',    etiqueta_admin: 'Anestesia' },
        { id: 'dra_patricia',  rol: 'medico',        nombre: 'Dra. Patricia Gómez', cargo: 'Ginecología y Obstetricia',     cedula_profesional: '5544332',  cedula_general: '5544332', cedula_especialidad: '9988776', cedula_subespecialidad: '', cedulas_visibles: ['general', 'especialidad'], codigo_rapido: '5544', especialidad_codigo: 'GINECOLOGIA_OBSTETRICIA', costo_consulta: 900, color_distintivo: 'rose', etiqueta_admin: 'Gineco-Obstetricia' },
        { id: 'dr_carlos_ped', rol: 'medico',        nombre: 'Dr. Carlos Méndez',  cargo: 'Pediatría y Neonatología',       cedula_profesional: '4433221',  cedula_general: '4433221', cedula_especialidad: '8877665', cedula_subespecialidad: '', cedulas_visibles: ['general', 'especialidad'], codigo_rapido: '4433', especialidad_codigo: 'PEDIATRIA',             costo_consulta: 800, color_distintivo: 'cyan',    etiqueta_admin: 'Pediatría' },
        { id: 'lic_psicologia',rol: 'medico',        nombre: 'Lic. Sofía Torres',  cargo: 'Psicología Clínica',             cedula_profesional: '6677889',  cedula_general: '6677889', cedula_especialidad: '', cedula_subespecialidad: '', cedulas_visibles: ['general'], codigo_rapido: '6677', especialidad_codigo: 'PSICOLOGIA',            costo_consulta: 600, color_distintivo: 'violet',  etiqueta_admin: 'Psicología' }
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
        ver_hospitalizados:        ['admin', 'administrador', 'medico'].concat(ENFERMERIAS),
        ver_quirofano:             ['admin', 'administrador', 'enf_hospital', 'enf_quirofano', 'medico'],
        ver_farmacia:              ['admin', 'administrador', 'enf_farmacia'],
        // ----
        gestionar_personal:        ['admin'],
        asignar_cama:              ['admin', 'administrador', 'medico'].concat(ENFERMERIAS),
        programar_cirugia:         ['admin', 'administrador', 'medico'],
        corregir_datos_paciente:   ['admin'],
        dar_alta_hospital:         ['medico'],                           // solo el médico tratante (se valida la relación)
        cargar_consumos:           ['admin', 'administrador'].concat(ENFERMERIAS),
        ver_cuentas_cobrar:        ['admin', 'administrador'],
        cerrar_expediente_pago:    ['admin', 'administrador'],
        cargar_cuenta_consulta:    ['admin', 'administrador'].concat(ENFERMERIAS),
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
        { codigo: 'HOSP-1', numero: '1', nombre: 'Hospitalización — Habitación 1', area: 'HOSPITALIZACION', plano_id: 'HOSP-1', plano_etiqueta: 'Habitación 1' },
        { codigo: 'HOSP-2', numero: '2', nombre: 'Hospitalización — Habitación 2', area: 'HOSPITALIZACION', plano_id: 'HOSP-2', plano_etiqueta: 'Habitación 2' },
        { codigo: 'HOSP-3', numero: '3', nombre: 'Hospitalización — Habitación 3', area: 'HOSPITALIZACION', plano_id: 'HOSP-3', plano_etiqueta: 'Habitación 3' },
        { codigo: 'HOSP-4', numero: '4', nombre: 'Hospitalización — Habitación 4', area: 'HOSPITALIZACION', plano_id: 'HOSP-4', plano_etiqueta: 'Habitación 4 (Gineco / Cesárea)' },
        { codigo: 'HOSP-5', numero: '5', nombre: 'Hospitalización — Habitación 5', area: 'HOSPITALIZACION', plano_id: 'HOSP-5', plano_etiqueta: 'Habitación 5 (Maternidad / Parto)' },
        { codigo: 'HOSP-AISLADO', numero: 'Aislado', nombre: 'Hospitalización — Aislado', area: 'HOSPITALIZACION', plano_id: 'HOSP-AISLADO', plano_etiqueta: 'Habitación Aislada' },
        { codigo: 'CUNERO-1', numero: 'Cunero', nombre: 'Hospitalización — Cunero', area: 'HOSPITALIZACION', plano_id: 'CUNERO-1', plano_etiqueta: 'Cunero' },
        { codigo: 'OBS-1', numero: '1', nombre: 'Observación — Cama 1 (Hidratación)', area: 'OBSERVACION', plano_id: 'OBS-1', plano_etiqueta: 'Hidratación (Obs. 1)' },
        { codigo: 'OBS-2', numero: '2', nombre: 'Observación — Cama 2 (Curaciones)', area: 'OBSERVACION', plano_id: 'OBS-2', plano_etiqueta: 'Curaciones (Obs. 2)' },
        { codigo: 'CONS-1', numero: '1', nombre: 'Consultorio 01 — Consulta Externa', area: 'CONSULTORIO_EXTRA', plano_id: 'CONS-1', plano_etiqueta: 'Consultorio 01' },
        { codigo: 'CONS-2', numero: '2', nombre: 'Consultorio 02 — Consulta Externa', area: 'CONSULTORIO_EXTRA', plano_id: 'CONS-2', plano_etiqueta: 'Consultorio 02' },
        { codigo: 'REC-1', numero: '1', nombre: 'Recuperación — Cama 1', area: 'QUIROFANO', plano_id: 'REC-1', plano_etiqueta: 'Recuperación 1' },
        { codigo: 'REC-2', numero: '2', nombre: 'Recuperación — Cama 2 (Valoración)', area: 'QUIROFANO', plano_id: 'REC-2', plano_etiqueta: 'Valoración y Rec. 2' },
        { codigo: 'REC-GINECO', numero: 'Gineco', nombre: 'Recuperación — Gineco / Preparación', area: 'QUIROFANO', plano_id: 'REC-GINECO', plano_etiqueta: 'Rec. Gineco' }
    ];
    const ALIAS_CODIGO_CAMA = {
        CAMA_1: 'HOSP-1', CAMA_2: 'HOSP-2', CAMA_3: 'HOSP-3', CAMA_4: 'HOSP-4', AISLADO: 'HOSP-AISLADO',
        'HOSP-5': 'HOSP-5', CAMA_5: 'HOSP-5', PEDIATRIA: 'HOSP-4', CUNERO: 'CUNERO-1',
        OBS_1: 'OBS-1', OBS_2: 'OBS-2', CONS_EXTRA: 'CONS-1', CONS_2: 'CONS-2',
        REC_GEN_1: 'REC-1', REC_GEN_2: 'REC-2', REC_GINECO: 'REC-GINECO'
    };
    const ALIAS_NOMBRE_CAMA = {
        'cama 1': 'HOSP-1', 'habitacion 1': 'HOSP-1', 'hospitalizacion - cama 1': 'HOSP-1', 'hospitalizacion — cama 1': 'HOSP-1',
        'cama 2': 'HOSP-2', 'habitacion 2': 'HOSP-2', 'hospitalizacion - cama 2': 'HOSP-2', 'hospitalizacion — cama 2': 'HOSP-2',
        'cama 3': 'HOSP-3', 'habitacion 3': 'HOSP-3', 'hospitalizacion - cama 3': 'HOSP-3', 'hospitalizacion — cama 3': 'HOSP-3',
        'cama 4': 'HOSP-4', 'habitacion 4': 'HOSP-4', 'hospitalizacion - cama 4': 'HOSP-4', 'hospitalizacion — cama 4': 'HOSP-4',
        aislado: 'HOSP-AISLADO', 'habitacion aislada': 'HOSP-AISLADO', 'habitacion 4 aislada': 'HOSP-AISLADO', 'hospitalizacion - aislado': 'HOSP-AISLADO', 'hospitalizacion — aislado': 'HOSP-AISLADO',
        'cama 5': 'HOSP-5', 'habitacion 5': 'HOSP-5', 'hospitalizacion - cama 5': 'HOSP-5', 'hospitalizacion — cama 5': 'HOSP-5', 'hospitalizacion — habitacion 5': 'HOSP-5', pediatria: 'HOSP-4', 'hosp-5': 'HOSP-5',
        cunero: 'CUNERO-1',
        'observacion 1': 'OBS-1', hidratacion: 'OBS-1', 'observacion — cama 1': 'OBS-1',
        'observacion 2': 'OBS-2', curaciones: 'OBS-2', 'observacion — cama 2': 'OBS-2',
        'consultorio extra': 'CONS-1', 'consultorio 01': 'CONS-1', 'consultorioextra — puesto 1': 'CONS-1', 'consultorio extra — puesto 1': 'CONS-1', 'consultorio 02': 'CONS-2',
        'recuperacion general 1': 'REC-1', 'recuperacion — cama 1': 'REC-1',
        'recuperacion general 2': 'REC-2', 'recuperacion — cama 2': 'REC-2',
        'recuperacion gineco': 'REC-GINECO', 'recuperacion gineco-obstetrica': 'REC-GINECO', 'recuperacion — gineco': 'REC-GINECO'
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
    function normalizarCodigoCama(pista) {
        const c = resolverCama(pista);
        return c ? c.codigo : '';
    }
    function camaPorCodigo(pista) {
        return resolverCama(pista);
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
        { sku: 'FEN-50', nombre: 'Fentanilo 0.5 mg / 10 ml (Fracción I)', fraccion: 'I', presentacion: 'Ámpula 0.5 mg / 10 ml', dosis_sugerida: '100-150 mcg IV' },
        { sku: 'MID-5', nombre: 'Midazolam 5 mg / 5 ml (Fracción II)', fraccion: 'II', presentacion: 'Ámpula 5 mg / 5 ml', dosis_sugerida: '2-5 mg IV' },
        { sku: 'PRO-200', nombre: 'Propofol 200 mg / 20 ml (Fracción IV)', fraccion: 'IV', presentacion: 'Ámpula 200 mg / 20 ml', dosis_sugerida: '150-200 mg IV' },
        { sku: 'BUP-05', nombre: 'Bupivacaína pesada 0.5% 15 mg / 3 ml (Fracción IV)', fraccion: 'IV', presentacion: 'Ámpula 15 mg / 3 ml', dosis_sugerida: '10-12.5 mg intratecal' },
        { sku: 'PROP-40', nombre: 'Propranolol 40 mg / 1 mg IV (Fracción IV)', fraccion: 'IV', presentacion: 'Ámpula / Tab 40 mg', dosis_sugerida: '1-3 mg IV / 40 mg VO' },
        { sku: 'KET-30', nombre: 'Ketorolaco 30 mg / 1 ml IV (Fracción IV)', fraccion: 'IV', presentacion: 'Ámpula 30 mg / 1 ml', dosis_sugerida: '30-60 mg IV' },
        { sku: 'OND-8', nombre: 'Ondansetrón 8 mg / 4 ml IV (Fracción IV)', fraccion: 'IV', presentacion: 'Ámpula 8 mg / 4 ml', dosis_sugerida: '4-8 mg IV' }
    ];

    // ---------------------------------------------------------------- Utilidades
    const _cacheLectura = {};
    function leer(clave, porDefecto) {
        try {
            const raw = localStorage.getItem(clave);
            if (raw === null || raw === undefined) { delete _cacheLectura[clave]; return porDefecto; }
            const hit = _cacheLectura[clave];
            if (hit && hit.raw === raw) {
                return JSON.parse(raw);
            }
            const v = JSON.parse(raw);
            _cacheLectura[clave] = { raw: raw };
            return (v === null || v === undefined) ? porDefecto : v;
        } catch (e) { return porDefecto; }
    }
    function escribir(clave, valor) {
        try {
            const raw = JSON.stringify(valor);
            localStorage.setItem(clave, raw);
            _cacheLectura[clave] = { raw: raw };
            return true;
        } catch (e) { return false; }
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
    function calcularEdadDetallada(fn, ref) {
        const nac = parseFechaISO(fn);
        if (!nac) return null;
        const r = ref ? new Date(ref) : new Date();
        const hoy = new Date(r.getFullYear(), r.getMonth(), r.getDate());
        const n = new Date(nac.getFullYear(), nac.getMonth(), nac.getDate());
        const diffDias = Math.floor((hoy.getTime() - n.getTime()) / 86400000);
        if (diffDias < 0) return null;
        let anios = hoy.getFullYear() - n.getFullYear();
        let meses = hoy.getMonth() - n.getMonth();
        let dias = hoy.getDate() - n.getDate();
        if (dias < 0) {
            meses--;
            const prevMes = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
            dias += prevMes.getDate();
        }
        if (meses < 0) {
            anios--;
            meses += 12;
        }
        const mesesTotales = anios * 12 + meses;
        let texto = "";
        if (mesesTotales < 1) {
            texto = diffDias === 0 ? "RN · Recién nacido" : ("RN · " + diffDias + (diffDias === 1 ? " día" : " días"));
        } else if (anios < 1) {
            texto = meses + (meses === 1 ? " mes" : " meses") + (meses < 3 && dias > 0 ? (" " + dias + (dias === 1 ? " día" : " días")) : "");
        } else if (anios < 3) {
            texto = anios + (anios === 1 ? " año" : " años") + (meses > 0 ? (" " + meses + (meses === 1 ? " mes" : " meses")) : "");
        } else {
            texto = anios + " años";
        }
        return { anios: anios, meses: meses, dias: dias, dias_totales: diffDias, meses_totales: mesesTotales, es_rn: mesesTotales < 1, es_lactante: anios < 2, texto: texto };
    }
    function formatearEdad(fn, edadAniosFallback, ref) {
        if (fn) {
            const det = calcularEdadDetallada(fn, ref);
            if (det && det.texto) return det.texto;
        }
        if (edadAniosFallback !== null && edadAniosFallback !== undefined && edadAniosFallback !== "") {
            const s = String(edadAniosFallback).trim();
            if (/rn|mes|d[ií]a|a[ñn]o/i.test(s)) return s;
            const n = Number(s);
            if (Number.isFinite(n)) {
                if (n === 0) return "RN / < 1 año";
                return n + (n === 1 ? " año" : " años");
            }
        }
        return "";
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
        { codigo: 'general', campo: 'cedula_general', etiqueta: 'Céd. Prof.', etiquetaFormulario: 'Cédula Profesional (Licenciatura)' },
        { codigo: 'especialidad', campo: 'cedula_especialidad', etiqueta: 'Céd. Esp.', etiquetaFormulario: 'Cédula de Especialidad' },
        { codigo: 'subespecialidad', campo: 'cedula_subespecialidad', etiqueta: 'Céd. Subesp.', etiquetaFormulario: 'Cédula de Subespecialidad' }
    ];
    function esMedicoGeneral(u) {
        return !!u && u.rol === 'medico' && (u.especialidad_codigo === 'MEDICINA_GENERAL' || !u.especialidad_codigo);
    }
    function especialidadImpresaMedico(u) {
        if (!u) return '';
        if (u.titulo_impreso && limpiarEspacios(u.titulo_impreso)) return limpiarEspacios(u.titulo_impreso);
        const esp = u.especialidad_codigo ? especialidadPorCodigo(u.especialidad_codigo) : null;
        return (esp && esp.nombre) || u.cargo || 'Medicina General';
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
            if (!u.titulo_impreso) {
                const esp = especialidadPorCodigo(u.especialidad_codigo);
                u.titulo_impreso = (esp && esp.nombre) || u.cargo || 'Medicina General';
                cambio = true;
            }
            if (!Array.isArray(u.cedulas_visibles)) { u.cedulas_visibles = []; cambio = true; }
            if (general) {
                if (!u.cedulas_visibles.length) { u.cedulas_visibles = ['general']; cambio = true; }
            } else if (!u.cedulas_visibles.length) {
                u.cedulas_visibles = u.cedula_especialidad ? ['especialidad'] : (u.cedula_general ? ['general'] : []);
                cambio = true;
            }
        });
        if (cambio) guardarListaUsuarios(lista);
    }
    function lineasCedulaFirma(u) {
        if (!u) return [];
        if (u.rol !== 'medico') return u.cedula_profesional ? [{ codigo: 'profesional', etiqueta: 'Céd. Prof.', valor: u.cedula_profesional }] : [];
        const registradas = CEDULAS_FIRMA.filter(c => u[c.campo]);
        if (!registradas.length && u.cedula_profesional) {
            return [{ codigo: 'general', etiqueta: 'Céd. Prof.', valor: u.cedula_profesional }];
        }
        let visibles = (Array.isArray(u.cedulas_visibles) ? u.cedulas_visibles : []).filter(c => registradas.some(r => r.codigo === c));
        if (!visibles.length && registradas.length) visibles = [registradas[0].codigo];
        return CEDULAS_FIRMA.filter(c => visibles.indexOf(c.codigo) >= 0 && u[c.campo]).map(c => ({ codigo: c.codigo, etiqueta: c.etiqueta, valor: u[c.campo] }));
    }
    function textoCedulasFirma(u) {
        return lineasCedulaFirma(u).map(l => l.etiqueta + ': ' + l.valor).join(' · ');
    }
    function resumenCedulas(u) {
        if (!u) return '';
        if (u.rol !== 'medico') return u.cedula_profesional || '';
        return lineasCedulaFirma(u).map(l => l.valor).join(' · ') || u.cedula_profesional || '';
    }
    function guardarCedulasVisibles(usuarioId, visibles, s, datosExtra) {
        const u = USUARIOS[usuarioId];
        if (!u || u.rol !== 'medico') return { ok: false, motivo: 'Solo un médico tiene cédulas de firma.' };
        const propio = s && s.usuario_id === usuarioId && s.rol === 'medico';
        const admin = s && PERMISOS.gestionar_personal.includes(s.rol);
        if (!propio && !admin) return { ok: false, motivo: 'Solo el médico o la dirección pueden configurar las cédulas que se imprimen.' };
        const lista = listaUsuariosCruda();
        const row = lista.find(x => x.id === usuarioId);
        if (!row) return { ok: false, motivo: 'No se encontró al médico.' };
        if (datosExtra && typeof datosExtra === 'object') {
            if (datosExtra.titulo_impreso !== undefined) {
                const tit = limpiarEspacios(datosExtra.titulo_impreso);
                if (tit.length >= 2 && tit.length <= 100) row.titulo_impreso = tit;
            }
            if (datosExtra.universidad_titulo !== undefined) {
                row.universidad_titulo = limpiarEspacios(datosExtra.universidad_titulo).slice(0, 100);
            }
            CEDULAS_FIRMA.forEach(c => {
                if (datosExtra[c.campo] !== undefined) {
                    const val = cedulaNormalizada(datosExtra[c.campo]);
                    if (val && !cedulaConFormato(val)) return;
                    row[c.campo] = val;
                }
            });
        }
        let pedidas = (Array.isArray(visibles) ? visibles : []).filter(c => CEDULAS_FIRMA.some(x => x.codigo === c));
        if (!pedidas.length && esMedicoGeneral(row)) pedidas = ['general'];
        if (!pedidas.length) return { ok: false, motivo: 'Seleccione al menos una cédula registrada para imprimir.' };
        const sinNumero = pedidas.filter(c => { const def = CEDULAS_FIRMA.find(x => x.codigo === c); return !row[def.campo]; });
        if (sinNumero.length) return { ok: false, motivo: 'Solo puede marcar para impresión las cédulas que tengan número capturado.' };
        row.cedulas_visibles = pedidas;
        const lineas = lineasCedulaFirma(Object.assign({}, row));
        if (lineas[0]) row.cedula_profesional = lineas[0].valor;
        const ok = guardarListaUsuarios(lista);
        if (ok && s && s.usuario_id === usuarioId && row.titulo_impreso && typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem('belen_especialidad', row.titulo_impreso);
        }
        return ok ? { ok: true, usuario: USUARIOS[usuarioId] } : { ok: false, motivo: 'No se pudo guardar (almacenamiento lleno o bloqueado).' };
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
            sessionStorage.setItem('belen_especialidad', especialidadImpresaMedico(u) || (esp ? esp.nombre : u.cargo));
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
    function esEspecialidadQuirurgica(espCodigo) {
        return ['CIRUGIA_GENERAL', 'GINECOLOGIA_OBSTETRICIA', 'TRAUMATOLOGIA', 'TRAUMATOLOGIA_ORTOPEDIA', 'ANGIOLOGIA'].indexOf(String(espCodigo || '')) >= 0;
    }
    function permisoAccionDe(usuarioId, accion) {
        const u = USUARIOS[usuarioId];
        if (!u || !PERMISOS[accion] || u.activo === false) return false;
        if (u.rol === 'admin') return true;
        const ajuste = (leerPermisosPersonal()[usuarioId] || {})[accion];
        if (typeof ajuste === 'boolean') return ajuste;
        if (accion === 'programar_cirugia' && u.rol === 'medico') {
            return esEspecialidadQuirurgica(u.especialidad_codigo);
        }
        return PERMISOS[accion].includes(u.rol);
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
            titulo_impreso: entrada.rol === 'medico' ? limpiarEspacios(entrada.titulo_impreso || '') : null,
            universidad_titulo: entrada.rol === 'medico' ? limpiarEspacios(entrada.universidad_titulo || '') : null,
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
            const espObj = especialidadPorCodigo(v.especialidad_codigo);
            registro.titulo_impreso = v.titulo_impreso || (previo && previo.titulo_impreso) || (espObj ? espObj.nombre : v.cargo);
            registro.universidad_titulo = v.universidad_titulo !== undefined ? v.universidad_titulo : ((previo && previo.universidad_titulo) || '');
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
                nacionalidad: limpiarEspacios(datos.nacionalidad || '') || 'Mexicana',
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
        ['sexo', 'nacionalidad', 'lugar_nacimiento', 'religion', 'estado_civil', 'telefono', 'ocupacion', 'direccion', 'contacto_emergencia'].forEach(k => { if (datos[k]) p[k] = datos[k]; });
        if (!p.nacionalidad) p.nacionalidad = 'Mexicana';
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
        ['telefono', 'direccion', 'sexo', 'nacionalidad', 'lugar_nacimiento', 'religion', 'estado_civil', 'ocupacion', 'nombres', 'apellido_paterno', 'apellido_materno', 'contacto_emergencia'].forEach(k => {
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
        if (parche && (parche.estatus === ESTATUS.ALTA_PENDIENTE_PAGO || parche.estatus === ESTATUS.ALTA) && (t.cuenta_pagada === true || parche.cuenta_pagada === true) && parche.cuenta_pagada !== false) {
            // Ya se cobró en Caja (pre-cobro): al cerrar la consulta pasa directo a histórico, sin volver a Cuentas por Cobrar.
            parche = Object.assign({}, parche, { estatus: ESTATUS.CERRADO_HISTORICO, cerrado_en: t.cerrado_en || new Date().toISOString(), lista_para_cobro: false });
        }
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
            nacionalidad: paciente.nacionalidad || 'Mexicana',
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
        if (!s || !turno) return false;
        if (s.rol === 'enf_quirofano') return true;
        if (s.rol === 'admin' || s.rol === 'administrador' || esEnfermeria(s.rol) || s.rol === 'enf_farmacia') return true;
        if (s.rol === 'medico') {
            const mid = s.medico_id || s.usuario_id;
            const i = internamientoDeTurno(turno.turno_id);
            if (turno.medico_id === mid || (i && i.medico_tratante_id === mid) || tieneInterconsulta(turno.turno_id, mid)) return true;
            if (listarCirugias().some(c => (c.turno_id === turno.turno_id || (turno.paciente_id && c.paciente_id === turno.paciente_id && c.estatus !== 'cancelada')) && (c.medico_cirujano_id === mid || c.anestesiologo_id === mid || c.pediatra_id === mid))) return true;
            if (s.especialidad_codigo === 'ANESTESIOLOGIA' && (pacienteAsignadoAnestesia(turno, mid) || pacienteEnFlujoQuirofano(turno))) return true;
            if (s.especialidad_codigo === 'PEDIATRIA' && i && (String(i.cama_codigo || '').indexOf('CUNERO') >= 0 || (i.hojas_recien_nacido && i.hojas_recien_nacido.length))) return true;
        }
        return false;
    }
    function pacienteEnFlujoQuirofano(turno) {
        if (!turno) return false;
        const i = internamientoDeTurno(turno.turno_id);
        if (turno.modalidad === MODALIDAD_AMBULATORIO_QX || (i && i.modalidad === MODALIDAD_AMBULATORIO_QX)) return true;
        const u = ubicacionDe(i);
        if (u === UBICACION_QX.EN_TRANSITO_QUIROFANO || u === UBICACION_QX.QUIROFANO || u === UBICACION_QX.EN_QUIROFANO || u === UBICACION_QX.EN_RECUPERACION) return true;
        if (i && (i.cirugia_id || (i.notas_preanestesicas && i.notas_preanestesicas.length) || (i.notas_postoperatorias && i.notas_postoperatorias.length))) return true;
        return listarCirugias().some(c => (c.turno_id === turno.turno_id || (turno.paciente_id && c.paciente_id === turno.paciente_id)) && c.estatus !== 'cancelada');
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
        ta_sistolica:            { min: 30,  max: 300, entero: true,  etiqueta: 'Tensión arterial sistólica', unidad: 'mmHg' },
        ta_diastolica:           { min: 15,  max: 200, entero: true,  etiqueta: 'Tensión arterial diastólica', unidad: 'mmHg' },
        frecuencia_cardiaca:     { min: 15,  max: 280, entero: true,  etiqueta: 'Frecuencia cardíaca', unidad: 'lpm' },
        frecuencia_respiratoria: { min: 2,   max: 90,  entero: true,  etiqueta: 'Frecuencia respiratoria', unidad: 'rpm' },
        temperatura_c:           { min: 25,  max: 45,  entero: false, etiqueta: 'Temperatura', unidad: '°C' },
        spo2_porcentaje:         { min: 20,  max: 100, entero: true,  etiqueta: 'Saturación de oxígeno', unidad: '%' },
        peso_kg:                 { min: 0.3, max: 400, entero: false, etiqueta: 'Peso', unidad: 'kg', opcional: true },
        talla_m:                 { min: 0.2, max: 2.6, entero: false, etiqueta: 'Talla', unidad: 'm', opcional: true },
        glucemia:                { min: 10,  max: 600, entero: true,  etiqueta: 'Glucosa capilar (Dxtx)', unidad: 'mg/dL', opcional: true }
    };
    function alertasSignosVitales(sv) {
        if (!sv) return { critico: false, alertas: [] };
        const a = [];
        const sis = Number(sv.ta_sistolica), dia = Number(sv.ta_diastolica);
        if (sis >= 180 || dia >= 120) a.push({ nivel: 'critico', campo: 'TA', texto: 'Crisis hipertensiva (' + sis + '/' + dia + ' mmHg)' });
        else if (sis >= 140 || dia >= 90) a.push({ nivel: 'alerta', campo: 'TA', texto: 'TA elevada (' + sis + '/' + dia + ' mmHg)' });
        else if (sis > 0 && (sis < 90 || dia < 60)) a.push({ nivel: 'critico', campo: 'TA', texto: 'Hipotensión (' + sis + '/' + dia + ' mmHg)' });
        const fc = Number(sv.frecuencia_cardiaca);
        if (fc >= 130) a.push({ nivel: 'critico', campo: 'FC', texto: 'Taquicardia importante (' + fc + ' lpm)' });
        else if (fc > 100) a.push({ nivel: 'alerta', campo: 'FC', texto: 'Taquicardia (' + fc + ' lpm)' });
        else if (fc > 0 && fc < 50) a.push({ nivel: 'critico', campo: 'FC', texto: 'Bradicardia (' + fc + ' lpm)' });
        const fr = Number(sv.frecuencia_respiratoria);
        if (fr >= 28 || (fr > 0 && fr < 10)) a.push({ nivel: 'critico', campo: 'FR', texto: 'FR crítica (' + fr + ' rpm)' });
        else if (fr > 20) a.push({ nivel: 'alerta', campo: 'FR', texto: 'Taquipnea (' + fr + ' rpm)' });
        const temp = Number(sv.temperatura_c);
        if (temp >= 39.5) a.push({ nivel: 'critico', campo: 'Temp', texto: 'Fiebre alta (' + temp + ' °C)' });
        else if (temp >= 38.0) a.push({ nivel: 'alerta', campo: 'Temp', texto: 'Fiebre (' + temp + ' °C)' });
        else if (temp > 0 && temp < 35.5) a.push({ nivel: 'critico', campo: 'Temp', texto: 'Hipotermia (' + temp + ' °C)' });
        const spo2 = Number(sv.spo2_porcentaje);
        if (spo2 > 0 && spo2 < 90) a.push({ nivel: 'critico', campo: 'SpO2', texto: 'Hipoxemia (' + spo2 + '%)' });
        else if (spo2 >= 90 && spo2 < 94) a.push({ nivel: 'alerta', campo: 'SpO2', texto: 'Desaturación leve (' + spo2 + '%)' });
        const glu = Number(sv.glucemia);
        if (glu >= 250) a.push({ nivel: 'critico', campo: 'Glucosa', texto: 'Hiperglucemia (' + glu + ' mg/dL)' });
        else if (glu > 0 && glu < 70) a.push({ nivel: 'critico', campo: 'Glucosa', texto: 'Hipoglucemia (' + glu + ' mg/dL)' });
        return { critico: a.some(x => x.nivel === 'critico'), alertas: a };
    }
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
        const mid = s.medico_id || s.usuario_id;
        if (turno.medico_id === mid || (i && i.medico_tratante_id === mid)) return 'tratante';
        if (((i && i.interconsultas) || []).some(x => x.medico_id === mid || (s.especialidad_codigo && x.especialidad_codigo === s.especialidad_codigo))) return 'interconsultante';
        const cirs = listarCirugias().filter(c => (i && c.cirugia_id === i.cirugia_id) || c.turno_id === turno.turno_id || (turno.paciente_id && c.paciente_id === turno.paciente_id && c.estatus !== 'cancelada'));
        if (cirs.some(c => c.medico_cirujano_id === mid || c.pediatra_id === mid)) return 'interconsultante';
        if (cirs.some(c => c.anestesiologo_id === mid) || (s.especialidad_codigo === 'ANESTESIOLOGIA' && cirs.length > 0)) return 'anestesiologo';
        return null;
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
        const enfQxAmb = (s.rol === 'enf_quirofano' && ambQx) || esEnfermeria(s.rol);
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
                 puede_escribir: activo && (s.rol === 'admin' || (s.rol === 'medico' && (relacion === 'tratante' || relacion === 'interconsultante' || relacion === 'anestesiologo'))),
                 puede_dar_alta: activo && (s.rol === 'admin' || (s.rol === 'medico' && (relacion === 'tratante' || relacion === 'interconsultante' || esCirujanoDelInternamiento(i, s)))),
                 puede_cargar_cuenta: activo && permisoAccionDe(s.usuario_id, 'cargar_consumos'),
                 puede_ver_cuenta: veCuenta,
                 puede_corregir: activo && !!PERMISOS.corregir_datos_paciente.includes(s.rol), turno: t };
    }
    function puedeEscribirInternamiento(s, i) {
        const a = accesoVisorHospitalizado(s, i);
        return a.ok && a.puede_escribir;
    }

    // ---- Interconsulta: otorga permiso inmediato al especialista (no imprime nada)
    function medicosParaInterconsulta(i, codigoEspecialidad, incluirExistentesParaPreop) {
        const t = i ? obtenerTurno(i.turno_id) : null;
        const ya = new Set(((i && i.interconsultas) || []).filter(x => {
            if (incluirExistentesParaPreop && codigoEspecialidad === 'MEDICINA_INTERNA' && x.tipo_interconsulta !== 'VALORACION_PREOPERATORIA') return false;
            return true;
        }).map(x => x.medico_id));
        return medicosDeEspecialidad(codigoEspecialidad).filter(m => m.medico_id !== (t && t.medico_id) && !ya.has(m.medico_id));
    }
    function solicitarInterconsulta(internamientoId, datos, s) {
        const i = obtenerInternamiento(internamientoId) || resolverInternamiento(internamientoId);
        if (!i || (!puedeEscribirInternamiento(s, i) && (!s || (s.rol !== 'admin' && s.rol !== 'medico')))) return { ok: false, motivo: 'No tiene permiso para solicitar interconsultas de este paciente.' };
        datos = datos || {};
        const esp = especialidadPorCodigo(datos.especialidad_codigo);
        const m = USUARIOS[datos.medico_id];
        if (!esp) return { ok: false, motivo: 'Seleccione la especialidad.' };
        if (!m || m.rol !== 'medico' || m.especialidad_codigo !== esp.codigo) return { ok: false, motivo: 'Seleccione un médico de esa especialidad.' };
        if (m.medico_id === (s && s.medico_id) && !datos.permitir_mismo_medico) return { ok: false, motivo: 'No puede solicitarse una interconsulta a sí mismo.' };
        if (m.medico_id === i.medico_tratante_id && !datos.permitir_tratante) return { ok: false, motivo: 'Ese médico ya es el médico tratante del paciente.' };
        const tipoIC = limpiarEspacios(datos.tipo_interconsulta || (esp.codigo === 'MEDICINA_INTERNA' && /preoperatori|asa|goldman|riesgos*quir/i.test(datos.motivo || '') ? 'VALORACION_PREOPERATORIA' : 'INTERCONSULTA_GENERAL'));
        const esValPreop = tipoIC === 'VALORACION_PREOPERATORIA' || !!datos.requiere_valoracion_preoperatoria || /preoperatori|asa|goldman|riesgos*quir/i.test(datos.motivo || '');
        const motivoTxt = limpiarEspacios(datos.motivo || (esValPreop ? 'Solicitud de Valoración Preoperatoria (Riesgo Quirúrgico ASA / Goldman)' : ('Valoración conjunta por ' + esp.nombre)));
        const existente = (i.interconsultas || []).find(x => x.medico_id === m.medico_id);
        if (existente) {
            if (esValPreop) {
                existente.tipo_interconsulta = 'VALORACION_PREOPERATORIA';
                existente.requiere_valoracion_preoperatoria = true;
                existente.motivo = motivoTxt;
                existente.actualizada_en = new Date().toISOString();
                if (existente.estatus === 'RESPONDIDA' && datos.reabrir_para_preoperatoria !== false) {
                    existente.estatus_previo = existente.estatus;
                }
                i.requiere_valoracion_preoperatoria = true;
                guardarInternamiento(i);
                return { ok: true, interconsulta: existente, actualizada: true };
            }
            return { ok: false, motivo: 'Ese médico ya tiene acceso a este paciente.' };
        }
        const ahoraIso = new Date().toISOString();
        const ic = {
            interconsulta_id: uid('IC'),
            especialidad_codigo: esp.codigo,
            especialidad: esp.nombre,
            medico_id: m.medico_id,
            medico_nombre: m.nombre,
            tipo_interconsulta: esValPreop ? 'VALORACION_PREOPERATORIA' : tipoIC,
            requiere_valoracion_preoperatoria: esValPreop,
            motivo: motivoTxt,
            estatus: 'PENDIENTE',
            fecha_hora: ahoraIso,
            solicitada_por_id: s ? s.usuario_id : 'admin',
            solicitada_por_nombre: s ? s.nombre : 'Dirección',
            solicitada_en: ahoraIso
        };
        if (esValPreop) i.requiere_valoracion_preoperatoria = true;
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
            subjetivo: String(entrada.subjetivo || '').trim(), exploracion_fisica: String(entrada.exploracion_fisica || entrada.objetivo || '').trim(),
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
        sincronizarCuentaEspejo(turnoId);
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
        const relEg = s.rol === 'admin' ? 'tratante' : relacionMedico(i, t, s);
        if (!PERMISOS.dar_alta_hospital.includes(s.rol) || (relEg !== 'tratante' && relEg !== 'interconsultante' && !esCirujanoDelInternamiento(i, s))) return { ok: false, motivo: 'Solo el médico tratante, el cirujano o el especialista interconsultante en tratamiento conjunto pueden dar de alta al paciente.' };
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
    // Garantiza el cargo de consulta al cerrar con Alta aunque no se haya pulsado "Liberar a Caja".
    function asegurarCargoConsulta(turnoId, s) {
        const t = obtenerTurno(turnoId);
        if (!t) return { ok: false, motivo: 'No se encontró la consulta.' };
        if (t.cuenta_pagada === true) return { ok: true, turno: t, ya_pagada: true };
        const ya = (t.cargos || []).some(c => c && (c.origen === 'consulta_medica' || /consulta m[eé]dica/i.test(c.concepto || '')));
        if (ya) return { ok: true, turno: t };
        return liberarConsultaACaja(turnoId, s);
    }
    function guardarNotaEgreso(internamientoId, entrada, s) { return registrarEgreso(internamientoId, entrada, s); }
    function cuentasPorCobrar(s) {
        if (!s || !PERMISOS.ver_cuentas_cobrar.includes(s.rol)) return [];
        return listarTurnos()
            .filter(t => t.cuenta_pagada !== true).filter(t => t.estatus === ESTATUS.ALTA_PENDIENTE_PAGO || ((t.lista_para_cobro || t.liberado_a_caja) && !t.cuenta_pagada && t.estatus !== ESTATUS.CERRADO_HISTORICO))
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
        if (t.cuenta_pagada === true) return { ok: false, motivo: 'Esta cuenta ya fue cobrada y liquidada previamente.' };
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
            ayudante_nombre: c.ayudante_nombre || 'Por asignar / Personal externo',
            instrumentista_nombre: c.instrumentista_nombre || 'Por asignar / Enfermería QX',
            circulante_nombre: c.circulante_nombre || 'Por asignar / Enfermería QX',
            pediatra_id: c.pediatra_id || null,
            pediatra_nombre: c.pediatra_nombre || '',
            requiere_pediatra: !!c.requiere_pediatra || /ces[aá]rea|parto|obst[eé]tr/i.test(c.procedimiento || ''),
            confirmada_admin: c.confirmada_admin !== false,
            estatus_confirmacion: c.estatus_confirmacion || (c.confirmada_admin === false ? 'PENDIENTE_ADMIN' : 'CONFIRMADA'),
            confirmada_por_nombre: c.confirmada_por_nombre || '',
            confirmada_en: c.confirmada_en || null,
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
    function cirujanos() { return medicosActivos().filter(u => esEspecialidadQuirurgica(u.especialidad_codigo)); }
    function anestesiologos() { return medicosDeEspecialidad('ANESTESIOLOGIA'); }
    function puedeIngresarAmbulatorio(s) {
        return !!s && (['admin', 'administrador', 'enf_quirofano', 'enf_hospital', 'enf_triage', 'medico'].indexOf(s.rol) >= 0);
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
            procedimiento: limpiarEspacios(entrada.procedimiento), tipo_estancia: (entrada.tipo_estancia === 'HOSPITALIZACION' ? 'HOSPITALARIA' : (entrada.tipo_estancia || '')), sala: (entrada.sala === 'SALA_1' ? 'QX-1' : (entrada.sala || 'QX-1')),
            fecha: entrada.fecha || '', hora_inicio: entrada.hora_inicio || '', duracion_minutos: Number(entrada.duracion_minutos),
            medico_cirujano_id: entrada.medico_cirujano_id || '', anestesiologo_id: entrada.anestesiologo_id || '',
            indicaciones_preoperatorias: String(entrada.indicaciones_preoperatorias || '').trim(), notas: String(entrada.notas || '').trim()
        };
        if (v.nombres || v.apellido_paterno || v.apellido_materno) { v.nombre = limpiarEspacios([v.nombres, v.apellido_paterno, v.apellido_materno].filter(Boolean).join(' ')); } else if (v.nombre) { const p = partesDeNombre(v.nombre); v.nombres = p.nombres; v.apellido_paterno = p.apellido_paterno; v.apellido_materno = p.apellido_materno; }
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
        const ped = entrada.pediatra_id && USUARIOS[entrada.pediatra_id] ? USUARIOS[entrada.pediatra_id] : null;
        const esAdminProg = s.rol === 'admin' || s.rol === 'administrador';
        const c = {
            cirugia_id: uid('CX'), paciente_id: pac ? pac.paciente_id : (v.paciente_id || null), paciente_nombre: pac ? pac.nombre_completo : v.nombre, fecha_nacimiento: v.fecha_nacimiento,
            procedimiento: v.procedimiento, tipo_estancia: v.tipo_estancia, sala: v.sala, fecha: v.fecha,
            hora_inicio: v.hora_inicio, hora_fin: v.hora_fin, duracion_minutos: v.duracion_minutos, fecha_hora: inicio.toISOString(),
            medico_cirujano_id: m.id, medico_cirujano_nombre: m.nombre,
            anestesiologo_id: an ? an.id : null, anestesiologo_nombre: an ? an.nombre : (limpiarEspacios(entrada.anestesiologo_externo || '') || ''),
            ayudante_nombre: limpiarEspacios(entrada.ayudante_nombre || 'Por asignar / Personal externo'),
            instrumentista_nombre: limpiarEspacios(entrada.instrumentista_nombre || 'Por asignar / Enfermería QX'),
            circulante_nombre: limpiarEspacios(entrada.circulante_nombre || 'Por asignar / Enfermería QX'),
            pediatra_id: ped ? ped.id : null,
            pediatra_nombre: ped ? ped.nombre : limpiarEspacios(entrada.pediatra_nombre || ''),
            requiere_pediatra: !!(entrada.requiere_pediatra || ped || entrada.pediatra_nombre || /ces[aá]rea|parto|obst[eé]tr/i.test(v.procedimiento || '')),
            confirmada_admin: esAdminProg,
            estatus_confirmacion: esAdminProg ? 'CONFIRMADA' : 'PENDIENTE_ADMIN',
            confirmada_por_nombre: esAdminProg ? s.nombre : '',
            confirmada_en: esAdminProg ? new Date().toISOString() : null,
            requiere_valoracion_preoperatoria: !!(entrada.requiere_valoracion_preoperatoria || entrada.solicitar_valoracion_preoperatoria),
            internista_id: entrada.internista_id || (entrada.requiere_valoracion_preoperatoria ? 'dr_internista' : null),
            motivo_valoracion_preoperatoria: limpiarEspacios(entrada.motivo_valoracion_preoperatoria || ''),
            indicaciones_preoperatorias: v.indicaciones_preoperatorias, notas: v.notas,
            turno_id: entrada.turno_id || null, ingresado_en: null,
            estatus: 'programada', programada_por_id: s.usuario_id, programada_por_nombre: s.nombre, creado_en: new Date().toISOString()
        };
        const lista = listarCirugias().concat([c]);
        if (!escribir(CLAVES.cirugias, lista)) return { ok: false, motivo: 'No se pudo guardar (almacenamiento lleno o bloqueado).' };
        // Vincular con internamiento activo del paciente si existe y gestionar solicitud de Valoración Preoperatoria
        const intsActivos = listarInternamientos().filter(x => x && (x.estatus === 'activo' || x.estatus === ESTATUS.INTERNADO || x.estatus === ESTATUS.INTERNADO_EN_PROCESO) && ((c.turno_id && x.turno_id === c.turno_id) || (c.paciente_id && x.paciente_id === c.paciente_id) || (c.paciente_nombre && normalizar(x.paciente_nombre || (obtenerTurno(x.turno_id) && obtenerTurno(x.turno_id).paciente_nombre) || '') === normalizar(c.paciente_nombre))));
        let icPreopGenerada = null;
        if (intsActivos.length) {
            const intAct = intsActivos[0];
            intAct.cirugia_id = c.cirugia_id;
            if (!intAct.etapa_qx) intAct.etapa_qx = 'EN_PISO';
            if (c.requiere_valoracion_preoperatoria) {
                intAct.requiere_valoracion_preoperatoria = true;
                guardarInternamiento(intAct);
                const idInternista = c.internista_id && USUARIOS[c.internista_id] ? c.internista_id : 'dr_internista';
                const resIC = solicitarInterconsulta(intAct.internamiento_id, {
                    especialidad_codigo: 'MEDICINA_INTERNA',
                    medico_id: idInternista,
                    tipo_interconsulta: 'VALORACION_PREOPERATORIA',
                    requiere_valoracion_preoperatoria: true,
                    permitir_mismo_medico: true,
                    motivo: c.motivo_valoracion_preoperatoria || ('Valoración Preoperatoria (ASA / Goldman) para cirugía programada: ' + c.procedimiento)
                }, s);
                if (resIC && resIC.ok) icPreopGenerada = resIC.interconsulta;
            } else {
                guardarInternamiento(intAct);
            }
        }
        return { ok: true, cirugia: fichaCirugia(c), interconsulta_preoperatoria: icPreopGenerada };
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
        const esHospDirecto = c.tipo_estancia === 'HOSPITALIZACION' || c.tipo_estancia === 'HOSPITALARIA';
        if (c.ingresado_en || c.turno_id) return { ok: false, motivo: 'Este paciente ya fue ingresado a quirófano.' };
        let pac = c.paciente_id ? buscarPacientePorId(c.paciente_id) : buscarPacientePorIdentidad(c.paciente_nombre, c.fecha_nacimiento);
        if (!pac) pac = guardarPaciente({ nombre_completo: c.paciente_nombre, fecha_nacimiento: c.fecha_nacimiento });
        if (pacienteInternadoActivo(Object.assign({}, c, { paciente_id: pac.paciente_id, paciente_nombre: pac.nombre_completo }))) return { ok: false, motivo: 'Este paciente ya tiene un episodio hospitalario activo.' };
        const medico = USUARIOS[c.medico_cirujano_id];
        if (!medico || !medico.medico_id) return { ok: false, motivo: 'No se encontró al cirujano de esta programación.' };
        const esp = especialidadPorCodigo(medico.especialidad_codigo);
        const ahoraIso = new Date().toISOString();
        const turnos = listarTurnos();
        const ocupadasRec = new Set(listarInternamientos().filter(x => x && x.estatus !== ESTATUS.ALTA_PENDIENTE_PAGO && x.estatus !== ESTATUS.CERRADO_HISTORICO && x.cama_codigo).map(x => x.cama_codigo));
        const camaRecPref = esHospDirecto
            ? (!ocupadasRec.has('HOSP-1') ? 'HOSP-1' : (!ocupadasRec.has('HOSP-2') ? 'HOSP-2' : (!ocupadasRec.has('HOSP-3') ? 'HOSP-3' : 'REC-GINECO')))
            : ((medico.especialidad_codigo === 'GINECOLOGIA_OBSTETRICIA' && !ocupadasRec.has('REC-GINECO')) ? 'REC-GINECO'
                : (!ocupadasRec.has('REC-1') ? 'REC-1' : (!ocupadasRec.has('REC-2') ? 'REC-2' : (!ocupadasRec.has('REC-GINECO') ? 'REC-GINECO' : 'REC-1'))));
        const camaRecObj = resolverCama(camaRecPref) || { codigo: esHospDirecto ? 'HOSP-1' : 'REC-1', nombre: esHospDirecto ? 'Hospitalización · Cama 1' : 'Recuperación 1' };
        const svDef = {
            ta_sistolica: 120, ta_diastolica: 78, frecuencia_cardiaca: 74, fc: 74,
            frecuencia_respiratoria: 16, fr: 16, temperatura_c: 36.6, temp: 36.6,
            saturacion_o2: 98, spo2: 98, peso_kg: 70, peso: 70, talla_m: 1.68, talla: 1.68, imc: 24.8
        };
        const turno = {
            turno_id: uid('T'), paciente_id: pac.paciente_id, paciente_nombre: pac.nombre_completo, fecha_nacimiento: pac.fecha_nacimiento || '1988-05-15', sexo: pac.sexo || 'F',
            especialidad_codigo: medico.especialidad_codigo, especialidad: esp ? esp.nombre : medico.cargo,
            medico_id: medico.medico_id, medico_nombre: medico.nombre, motivo: c.procedimiento, fecha_turno: hoyLocal(),
            numero_turno: siguienteNumeroTurno(medico.especialidad_codigo), timestamp_llegada: ahoraIso,
            estatus: ESTATUS.INTERNADO, modalidad: MODALIDAD_AMBULATORIO_QX, sin_nota_consulta: true,
            area_destino: AREA_AMBULATORIO_QX, destino: 'Quirofano', cama: camaRecObj.nombre, cama_codigo: camaRecObj.codigo,
            dx_principal: c.diagnostico_preoperatorio || c.procedimiento || '',
            signos_vitales: svDef, cargos: [], cuenta_actual: 0, cuenta_actual_total: 0,
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
            fecha_ingreso: ahoraIso, cama: camaRecObj.nombre, cama_codigo: camaRecObj.codigo, estatus: 'activo', modalidad: MODALIDAD_AMBULATORIO_QX, sin_nota_consulta: true,
            hoja_frontal_habilitada: true, consentimientos_habilitados: true,
            area_destino: AREA_AMBULATORIO_QX, destino: 'Quirofano',
            diagnostico_ingreso: c.diagnostico_preoperatorio || c.procedimiento, diagnostico_actual: c.diagnostico_preoperatorio || c.procedimiento, alergias: pac.alergias || 'Negadas',
            interconsultas: [], notas_evolucion: [], hojas_indicaciones: [hoja], cargos: [], cuenta_actual: 0, cuenta_actual_total: 0,
            nota_egreso: null, cirugia_id: c.cirugia_id,
            ubicacion: UBICACION_QX.EN_TRANSITO_QUIROFANO, cama_origen_piso: null,
            notas_preanestesicas: [], registros_transanestesicos: [], notas_postanestesicas: [], notas_postoperatorias: [], recetas_controlados: []
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


    function monitorCamas() {
        return CAMAS_HOSPITAL.map(c => {
            const inter = camaEstaOcupada(c, null);
            const t = inter ? obtenerTurno(inter.turno_id) : null;
            return {
                cama: c,
                ocupada: !!inter,
                internamiento: inter ? Object.assign({}, inter, { paciente_nombre: (t && t.paciente_nombre) || inter.paciente_nombre || "" }) : null
            };
        });
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
        if (!s || s.rol !== 'medico' || !i) return false;
        const mid = s.medico_id || s.usuario_id;
        const t = obtenerTurno(i.turno_id);
        if (relacionMedico(i, t, s) === 'tratante') return true;
        const c = cirugiaDeInternamiento(i);
        if (c && (c.medico_cirujano_id === mid || c.medico_cirujano_id === s.usuario_id)) return true;
        const esEspQx = ['CIRUGIA_GENERAL', 'GINECOLOGIA', 'GINECOLOGIA_OBSTETRICIA', 'TRAUMATOLOGIA', 'TRAUMATOLOGIA_ORTOPEDIA', 'ANGIOLOGIA'].indexOf(s.especialidad_codigo) >= 0;
        if (esEspQx && tieneInterconsulta(i.turno_id, mid)) return true;
        return false;
    }
    function esAnestesiologoDelInternamiento(i, s) {
        if (!s || s.rol !== 'medico' || s.especialidad_codigo !== 'ANESTESIOLOGIA') return false;
        return true;
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
        if (!t) return null;
        const i = internamientoDeTurno(turnoId);
        const p = buscarPacientePorId(t.paciente_id) || {};
        const c = (i && cirugiaDeInternamiento(i)) || cirugiaRawDePaciente(t);
        const ficha = c ? fichaCirugia(c) : null;
        const anest = (c && c.anestesiologo_id && USUARIOS[c.anestesiologo_id]) || USUARIOS.dra_elena || null;
        const snap = (i && i.snapshot_formulario) || {};
        const camposSnap = snap.campos || {};
        const fuentes = [];
        if (t.signos_vitales) fuentes.push(t.signos_vitales);
        if (i) ((i.notas_evolucion) || []).forEach(n => { if (n.objetivo && n.objetivo.signos_vitales) fuentes.push(n.objetivo.signos_vitales); });
        let peso = null, talla = null, taSis = null, taDia = null, fc = null, fr = null, temp = null, spo2 = null;
        fuentes.forEach(sv => {
            if (!sv) return;
            if (sv.peso_kg != null && sv.peso_kg !== '') peso = sv.peso_kg;
            else if (sv.peso != null && sv.peso !== '') peso = sv.peso;
            if (sv.talla_m != null && sv.talla_m !== '') talla = sv.talla_m;
            else if (sv.talla != null && sv.talla !== '') talla = sv.talla;
            if (sv.ta_sistolica != null) taSis = sv.ta_sistolica;
            if (sv.ta_diastolica != null) taDia = sv.ta_diastolica;
            if (sv.frecuencia_cardiaca != null) fc = sv.frecuencia_cardiaca;
            else if (sv.fc != null) fc = sv.fc;
            if (sv.frecuencia_respiratoria != null) fr = sv.frecuencia_respiratoria;
            else if (sv.fr != null) fr = sv.fr;
            if (sv.temperatura_c != null) temp = sv.temperatura_c;
            else if (sv.temp != null) temp = sv.temp;
            if (sv.saturacion_o2 != null) spo2 = sv.saturacion_o2;
            else if (sv.spo2 != null) spo2 = sv.spo2;
        });
        if (peso == null && camposSnap['val-peso']) peso = parseFloat(camposSnap['val-peso']);
        if (talla == null && camposSnap['val-talla']) talla = parseFloat(camposSnap['val-talla']);
        if (taSis == null && camposSnap['val-ta-sis']) taSis = camposSnap['val-ta-sis'];
        if (taDia == null && camposSnap['val-ta-dia']) taDia = camposSnap['val-ta-dia'];
        if (fc == null && camposSnap['val-fc']) fc = camposSnap['val-fc'];
        if (fr == null && camposSnap['val-fr']) fr = camposSnap['val-fr'];
        if (temp == null && camposSnap['val-temp']) temp = camposSnap['val-temp'];
        if (spo2 == null && camposSnap['val-spo2']) spo2 = camposSnap['val-spo2'];
        if (peso == null) peso = 70;
        if (talla == null) talla = 1.65;
        const imc = peso && talla ? Math.round((Number(peso) / (Number(talla) * Number(talla))) * 10) / 10 : 25.7;
        const grupo = camposSnap['val-grupo'] || ((((snap.antecedentes || {}).no_patologicos || {}).grupo_rh || {}).valor) || (i && i.grupo_rh) || p.tipo_sangre || 'O+';
        const fn = p.fecha_nacimiento || t.fecha_nacimiento || '1980-01-01';
        const edadCalc = calcularEdad(fn);
        const sexoRaw = p.sexo || t.sexo || '';
        const sexoTxt = sexoRaw === 'F' ? 'Femenino' : (sexoRaw === 'M' ? 'Masculino' : (sexoRaw || 'No registrado'));
        const alergiasTxt = limpiarEspacios((i && i.alergias) || camposSnap['val-alergias'] || alergiasDeBorrador(t.turno_id) || p.alergias || '') || 'Ninguna referida';
        const camaEtq = i ? (etiquetaCama(i.cama_codigo || i.cama || i.cama_origen_piso) || i.area_destino || 'Quirófano') : (etiquetaCama(t.cama_codigo || t.cama) || 'Quirófano');
        const preNotas = (i && i.notas_preanestesicas) || [];
        const ultPre = preNotas.length ? preNotas[preNotas.length - 1] : null;
        const valPreNotas = (i && i.valoraciones_preoperatorias) || (i && i.valoracion_preoperatoria ? [i.valoracion_preoperatoria] : []);
        const ultValPre = valPreNotas.length ? valPreNotas[valPreNotas.length - 1] : null;
        const transRegs = (i && i.registros_transanestesicos) || [];
        const ultTrans = transRegs.length ? transRegs[transRegs.length - 1] : null;
        const procTxt = (ficha && ficha.procedimiento) || (c && c.procedimiento) || (i && i.diagnostico_ingreso) || t.motivo || 'Procedimiento quirúrgico';
        const dxTxt = (i && (i.diagnostico_actual || i.diagnostico_ingreso)) || t.dx_principal || procTxt;
        return {
            turno_id: t.turno_id,
            internamiento_id: i ? i.internamiento_id : null,
            paciente_id: t.paciente_id || p.paciente_id || '',
            expediente: t.paciente_id || p.paciente_id || '',
            nombre: p.nombre_completo || t.paciente_nombre || '',
            paciente: p.nombre_completo || t.paciente_nombre || '',
            nacimiento: fechaLegibleISO(fn) || fn,
            fecha_nacimiento: fn,
            edad: edadCalc != null ? edadCalc : 45,
            edad_texto: formatearEdad(fn, edadCalc),
            sexo: sexoTxt,
            cama: camaEtq,
            peso: peso,
            talla: talla,
            imc: imc,
            ta: (taSis && taDia) ? (taSis + '/' + taDia + ' mmHg') : '120/78 mmHg',
            fc: (fc || 76) + ' lpm',
            fr: (fr || 16) + ' rpm',
            temp: (temp || 36.6) + ' °C',
            spo2: (spo2 || 98) + ' %',
            alergias: alergiasTxt,
            grupo_rh: grupo,
            diagnostico: dxTxt,
            procedimiento: procTxt,
            cirugia: procTxt,
            cirujano: (ficha && ficha.medico_cirujano) || (c && c.medico_cirujano_nombre) || (i && i.medico_tratante_nombre) || t.medico_nombre || '',
            anestesiologo: (ficha && ficha.anestesiologo) || (c && c.anestesiologo_nombre) || (anest && anest.nombre) || 'Dra. Elena Ríos',
            cedulas_anestesiologo: anest ? textoCedulasFirma(anest) : '',
            sala: (ficha && ficha.sala_nombre) || 'Quirófano Central',
            cuando: (ficha && ficha.hora_texto) || fechaHoraLegible(new Date().toISOString()),
            fecha: fechaLegibleISO(hoyLocal()),
            asa: (ultPre && ultPre.asa) || (ultValPre && (ultValPre.asa || ultValPre.clasificacion_asa)) || 'ASA II',
            mallampati: (ultPre && ultPre.mallampati) || 'Clase II',
            tecnica_planeada: (ultPre && (ultPre.tecnica_planeada || ultPre.tecnica_texto || ultPre.plan)) || 'Sedación consciente + anestesia balanceada',
            medicamentos_estimados: (ultPre && ultPre.medicamentos_solicitados) || [],
            ultimo_registro_trans: ultTrans
        };
    }
    function guardarNotaPostanestesica(turnoId, entrada, s) {
        const i = asegurarInternamiento(turnoId);
        const t = obtenerTurno(turnoId);
        if (!i || !t || t.estatus !== ESTATUS.INTERNADO) return { ok: false, motivo: 'El internamiento no está activo.' };
        if (!puedeNotaPostanestesica(s, i)) return { ok: false, motivo: 'Solo el anestesiólogo, el cirujano o Dirección pueden registrar la nota post-anestésica.' };
        const e = entrada || {};
        const tecnica = TECNICAS_ANESTESIA.find(x => x.codigo === e.tecnica) || (e.tecnica ? { codigo: String(e.tecnica), etiqueta: String(e.tecnica_texto || e.tecnica) } : null);
        const errores = {};
        if (!tecnica) errores.tecnica = 'Seleccione la técnica anestésica.';
        const aldrete = parseInt(e.aldrete != null ? e.aldrete : 9, 10);
        if (!Number.isInteger(aldrete) || aldrete < 0 || aldrete > 10) errores.aldrete = 'Aldrete va de 0 a 10.';
        const sangrado = limpiarEspacios(e.sangrado != null ? String(e.sangrado) : (e.sangrado_ml != null ? String(e.sangrado_ml) : '50 ml'));
        const incidentes = String(e.incidentes || 'Sin incidentes transanestésicos.').trim();
        const evolucion = String(e.evolucion || e.plan || '').trim();
        if (contarLetrasTxt(evolucion) < 10) errores.evolucion = 'Escriba la evolución post-anestésica (mínimo 10 letras).';
        const pendFI = ampulasFraccionIPendientes(turnoId);
        const justFI = Array.isArray(e.fraccion_i) ? e.fraccion_i : (Array.isArray(e.justificaciones_fi) ? e.justificaciones_fi : []);
        const faltanFI = pendFI.filter(u => { const j = justFI.find(x => x.uso_id === u.uso_id); return !j || !limpiarEspacios(j.lote) || !limpiarEspacios(j.dosis_administrada) || j.merma == null || String(j.merma).trim() === ''; });
        if (faltanFI.length) errores.fraccion_i = 'Justifique ' + faltanFI.length + ' ámpula(s) de Fracción I (Fentanilo/Midazolam): lote, dosis administrada y merma/desecho.';

        const preNotas = i.notas_preanestesicas || [];
        const ultPre = preNotas.length ? preNotas[preNotas.length - 1] : null;
        const estimadosMap = {};
        ((ultPre && ultPre.medicamentos_solicitados) || []).forEach(m => {
            if (m && m.sku) estimadosMap[m.sku] = parseInt(m.cantidad_estimada || m.cantidad || 0, 10) || 0;
        });

        const meds = Array.isArray(e.medicamentos) ? e.medicamentos : [];
        const usos = [];
        const conciliacion = [];
        meds.forEach(m => {
            if (!m || !m.sku) return;
            const cant = parseInt(m.cantidad != null ? m.cantidad : m.cantidad_real, 10);
            if (cant === 0) {
                const cat0 = MEDS_ANESTESIA.find(x => x.sku === m.sku) || productoPorSku(m.sku);
                if (cat0) {
                    conciliacion.push({
                        sku: cat0.sku,
                        nombre: cat0.nombre,
                        fraccion: cat0.fraccion || cat0.fraccion_cofepris || 'IV',
                        cantidad_estimada: m.cantidad_estimada != null ? (parseInt(m.cantidad_estimada, 10) || 0) : (estimadosMap[cat0.sku] || 0),
                        cantidad_real: 0,
                        dosis_administrada: 'No utilizado (0 ámpulas)',
                        merma: '0 ml'
                    });
                }
                return;
            }
            const cat = MEDS_ANESTESIA.find(x => x.sku === m.sku) || productoPorSku(m.sku);
            if (!cat || !Number.isInteger(cant) || cant < 1 || cant > 30) {
                errores.medicamentos = 'Revise los medicamentos y las cantidades (1 a 30).';
            } else {
                const frac = cat.fraccion || cat.fraccion_cofepris || 'IV';
                let cajaId = limpiarEspacios(m.caja_id);
                if (frac === 'I' && !cajaId) {
                    const cajasAb = cajasAbiertasDe(cat.sku, 'QUIROFANO').concat(listarCajas().filter(c => normalizar(c.sku) === normalizar(cat.sku) && restantesCaja(c) >= cant));
                    if (cajasAb.length) cajaId = cajasAb[0].caja_id;
                }
                const cantEst = m.cantidad_estimada != null ? (parseInt(m.cantidad_estimada, 10) || 0) : (estimadosMap[cat.sku] || 0);
                const itemUso = {
                    sku: cat.sku,
                    nombre: cat.nombre,
                    fraccion: frac,
                    cantidad: cant,
                    cantidad_estimada: cantEst,
                    caja_id: cajaId,
                    aplicador_id: m.aplicador_id || s.usuario_id,
                    dosis_administrada: limpiarEspacios(m.dosis_administrada || m.dosis || '') || (cant + ' ámpula(s) IV transanestésica'),
                    merma: limpiarEspacios(m.merma || '') || '0 ml',
                    lote: limpiarEspacios(m.lote || '')
                };
                usos.push(itemUso);
                conciliacion.push(Object.assign({}, itemUso, { cantidad_real: cant }));
            }
        });
        if (Object.keys(errores).length) return { ok: false, motivo: 'Revise los campos marcados.', errores: errores };
        const resumen = tecnica.etiqueta + '. Aldrete ' + aldrete + '. ' + evolucion;
        const recetas = [];
        const recetasFoliadas = [];
        usos.filter(u => u.fraccion === 'I').forEach(u => {
            const caja = u.caja_id ? listarCajas().find(c => c.caja_id === u.caja_id && normalizar(c.sku) === normalizar(u.sku)) : null;
            if (!caja) errores.medicamentos = 'Seleccione la caja abierta de ' + u.nombre + ' (Caja, lote, receta especial y ámpulas restantes).';
            else if (restantesCaja(caja) < u.cantidad) errores.medicamentos = 'La caja ' + caja.folio_receta_especial + ' no tiene ámpulas suficientes de ' + u.nombre + '.';
        });
        if (errores.medicamentos) return { ok: false, motivo: errores.medicamentos, errores: errores };

        const medicoAnest = USUARIOS[s.usuario_id] || s || {};
        const dxReceta = (i && (i.diagnostico_actual || i.diagnostico_ingreso)) || t.dx_principal || 'Procedimiento anestésico-quirúrgico';
        function crearRecetaFoliadaAnestesia(itemsGrupo, fraccionGrupo, subtituloNormativo) {
            if (!itemsGrupo.length) return null;
            const folio = reservarFolioReceta();
            const recObj = Object.assign({
                receta_id: uid('RX'),
                folio: folio,
                folio_externo: '',
                tipo_origen: 'CONTROLADO_HOSPITAL',
                origen_anestesia: true,
                fraccion_grupo: fraccionGrupo,
                subtitulo_normativo: subtituloNormativo,
                fecha_hora: new Date().toISOString(),
                turno_id: t.turno_id,
                internamiento_id: i.internamiento_id,
                medico_id: s.usuario_id,
                medico_nombre: s.nombre,
                medico_especialidad: especialidadImpresaMedico(medicoAnest) || 'Anestesiología',
                cedulas_impresas: textoCedulasFirma(medicoAnest),
                diagnostico: dxReceta,
                items: itemsGrupo,
                estatus_surtido: 'COMPLETA_RETENIDA'
            }, fichaPacienteReceta(t.paciente_id, t, {}));
            escribir(CLAVES.recetas, listarRecetas().concat([recObj]));
            return recObj;
        }

        // 1. Fracción I
        const itemsFoliadosFI = [];
        for (let k = 0; k < usos.length; k++) {
            const u = usos[k];
            if (u.fraccion !== 'I') continue;
            const r = dispensarAmpulas({
                caja_id: u.caja_id,
                cantidad: u.cantidad,
                turno_id: t.turno_id,
                aplicador_id: u.aplicador_id || s.usuario_id,
                datos: { lote: u.lote || (listarCajas().find(c => c.caja_id === u.caja_id) || {}).lote || 'L-FEN-26A', dosis_administrada: u.dosis_administrada, merma: u.merma, texto: resumen }
            }, s);
            if (!r.ok) return { ok: false, motivo: r.motivo };
            const loteCaja = r.caja.lote || u.lote || 'L-FEN-26A';
            u.lote = loteCaja;
            (r.usos || [r.uso]).forEach(uso => {
                recetas.push({
                    receta_id: uso.uso_id, uso_id: uso.uso_id, caja_id: r.caja.caja_id, sku: u.sku, nombre: r.caja.nombre, cantidad: 1, fraccion: 'I',
                    numero: uso.numero, de: uso.de, lote: uso.lote || loteCaja, folio_receta_especial: uso.folio_receta_especial || r.caja.folio_receta_especial,
                    dosis_administrada: u.dosis_administrada, merma: u.merma,
                    fecha_hora: uso.fecha_hora, turno_id: t.turno_id, paciente_id: t.paciente_id,
                    anestesiologo_id: s.usuario_id, anestesiologo_nombre: s.nombre, datos_postanestesicos: resumen
                });
            });
            const prodFI = productoPorSku(u.sku) || { sku: u.sku, nombre: r.caja.nombre || u.nombre, concentracion: '0.5 mg / 10 ml', forma_farmaceutica: 'SOLUCION_INYECTABLE' };
            itemsFoliadosFI.push({
                sku: u.sku,
                nombre: prodFI.nombre || u.nombre,
                concentracion: prodFI.concentracion || '0.5 mg / 10 ml',
                forma_farmaceutica: prodFI.forma_farmaceutica || 'SOLUCION_INYECTABLE',
                fraccion_cofepris: 'I',
                dosis_indicacion: u.dosis_administrada + ' · Merma: ' + u.merma + ' · Caja: ' + r.caja.caja_id + ' (Receta Especial ' + (r.caja.folio_receta_especial || '') + ') · Lote: ' + loteCaja,
                cantidad_prescrita: u.cantidad,
                cantidad_surtida: u.cantidad,
                lotes_surtidos: [{ lote: loteCaja, caducidad: r.caja.caducidad || '', cantidad: u.cantidad }]
            });
        }
        if (itemsFoliadosFI.length) {
            const recFI = crearRecetaFoliadaAnestesia(itemsFoliadosFI, 'I', 'RECETA ESPECIAL DE ANESTESIOLOGÍA — ESTUPEFACIENTE FRACCIÓN I (COFEPRIS ART. 226 LGS)');
            if (recFI) {
                recetasFoliadas.push(recFI);
                conciliacion.filter(c => c.fraccion === 'I' && c.cantidad_real > 0).forEach(c => { c.folio_receta = recFI.folio; c.receta_id = recFI.receta_id; });
            }
        }

        // 2. Fracción II y Fracción IV / VI
        const usosNoFI = usos.filter(u => u.fraccion !== 'I');
        if (usosNoFI.length) {
            const catalogo = listarFarmacia();
            const cargosNuevos = [];
            const itemsFII = [];
            const itemsFIV = [];
            usosNoFI.forEach(u => {
                const lote = catalogo.filter(p => normalizar(p.sku) === normalizar(u.sku) && p.stock > 0).sort((a, b) => String(a.caducidad).localeCompare(String(b.caducidad)))[0]
                    || catalogo.find(p => normalizar(p.sku) === normalizar(u.sku));
                const precioUnit = lote ? (Number(lote.precio_unitario || lote.precio) || 60) : 60;
                const loteCod = (lote && lote.lote) || u.lote || ('L-' + u.sku);
                const cadCod = (lote && lote.caducidad) || isoMasDias(365);
                u.lote = loteCod;
                if (lote && lote.stock >= u.cantidad) lote.stock -= u.cantidad;
                cargosNuevos.push({
                    sku: u.sku,
                    nombre: (lote && lote.nombre) || u.nombre,
                    lote: loteCod,
                    caducidad: cadCod,
                    cantidad: u.cantidad,
                    precio_unitario: precioUnit
                });
                const itemRec = {
                    sku: u.sku,
                    nombre: (lote && lote.nombre) || u.nombre,
                    concentracion: (lote && lote.concentracion) || '',
                    forma_farmaceutica: (lote && lote.forma_farmaceutica) || 'SOLUCION_INYECTABLE',
                    fraccion_cofepris: u.fraccion,
                    dosis_indicacion: u.dosis_administrada + (u.merma && u.merma !== '0 ml' ? ' · Merma: ' + u.merma : '') + ' · Lote: ' + loteCod + ' · Conciliado en Nota Postanestésica',
                    cantidad_prescrita: u.cantidad,
                    cantidad_surtida: u.cantidad,
                    lotes_surtidos: [{ lote: loteCod, caducidad: cadCod, cantidad: u.cantidad }]
                };
                if (u.fraccion === 'II' || u.fraccion === 'III') itemsFII.push(itemRec);
                else itemsFIV.push(itemRec);
            });
            escribir(CLAVES.farmacia, catalogo);
            if (cargosNuevos.length) {
                anexarCargosFarmacia(t.turno_id, cargosNuevos, { id: s.usuario_id, nombre: s.nombre, cedula_profesional: cedulaDeUsuario(s.usuario_id) });
            }
            if (itemsFII.length) {
                const recFII = crearRecetaFoliadaAnestesia(itemsFII, 'II', 'RECETA MÉDICA CONTROLADA RETENIDA — PSICOTRÓPICO FRACCIÓN II (ANESTESIOLOGÍA)');
                if (recFII) {
                    recetasFoliadas.push(recFII);
                    conciliacion.filter(c => (c.fraccion === 'II' || c.fraccion === 'III') && c.cantidad_real > 0).forEach(c => {
                        c.folio_receta = recFII.folio;
                        c.receta_id = recFII.receta_id;
                        recetas.push({
                            receta_id: recFII.receta_id, folio_sistema: recFII.folio, sku: c.sku, nombre: c.nombre, cantidad: c.cantidad_real,
                            fraccion: c.fraccion, lote: c.lote, dosis_administrada: c.dosis_administrada, merma: c.merma,
                            fecha_hora: recFII.fecha_hora, turno_id: t.turno_id, paciente_id: t.paciente_id,
                            anestesiologo_id: s.usuario_id, anestesiologo_nombre: s.nombre, datos_postanestesicos: resumen
                        });
                    });
                }
            }
            if (itemsFIV.length) {
                const recFIV = crearRecetaFoliadaAnestesia(itemsFIV, 'IV', 'RECETA DE MEDICAMENTOS ANESTÉSICOS Y ADYUVANTES — FRACCIÓN IV (ANESTESIOLOGÍA)');
                if (recFIV) {
                    recetasFoliadas.push(recFIV);
                    conciliacion.filter(c => c.fraccion !== 'I' && c.fraccion !== 'II' && c.fraccion !== 'III' && c.cantidad_real > 0).forEach(c => {
                        c.folio_receta = recFIV.folio;
                        c.receta_id = recFIV.receta_id;
                        recetas.push({
                            receta_id: recFIV.receta_id, folio_sistema: recFIV.folio, sku: c.sku, nombre: c.nombre, cantidad: c.cantidad_real,
                            fraccion: c.fraccion, lote: c.lote, dosis_administrada: c.dosis_administrada, merma: c.merma,
                            fecha_hora: recFIV.fecha_hora, turno_id: t.turno_id, paciente_id: t.paciente_id,
                            anestesiologo_id: s.usuario_id, anestesiologo_nombre: s.nombre, datos_postanestesicos: resumen
                        });
                    });
                }
            }
        }

        const vigente = obtenerInternamiento(i.internamiento_id);
        const nota = {
            nota_id: uid('PA'), folio: 'PA-' + pad3((vigente.notas_postanestesicas || []).length + 1), fecha_hora: new Date().toISOString(),
            autor_id: s.usuario_id, autor_nombre: s.nombre,
            autor_especialidad: especialidadImpresaMedico(medicoAnest) || 'Anestesiología',
            cedulas_impresas: textoCedulasFirma(medicoAnest),
            tecnica: tecnica.codigo, tecnica_texto: tecnica.etiqueta,
            aldrete: aldrete, sangrado: sangrado, incidentes: incidentes, evolucion: evolucion,
            signos_egreso_qx: e.signos_egreso_qx || { ta: e.ta_post || '118/74', fc: e.fc_post || '74', fr: e.fr_post || '16', spo2: e.spo2_post || '98', temp: e.temp_post || '36.5' },
            medicamentos: usos,
            conciliacion_medicamentos: conciliacion,
            recetas: recetas,
            recetas_generadas: recetas.map(r => r.receta_id),
            recetas_foliadas: recetasFoliadas.map(r => ({ receta_id: r.receta_id, folio: r.folio, fraccion: r.fraccion_grupo, subtitulo: r.subtitulo_normativo }))
        };
        vigente.notas_postanestesicas = (vigente.notas_postanestesicas || []).concat([nota]);
        vigente.recetas_controlados = (vigente.recetas_controlados || []).concat(recetas);
        nota.fraccion_i_justificada = justFI;
        if (!guardarInternamiento(vigente)) return { ok: false, motivo: 'No se pudo guardar la nota.' };
        if (justFI.length) justificarAmpulasFraccionI(turnoId, justFI, s);
        return { ok: true, nota: nota, recetas: recetas, recetas_foliadas: recetasFoliadas, internamiento: obtenerInternamiento(i.internamiento_id) };
    }
    function guardarNotaPostoperatoria(turnoId, entrada, s) {
        const i = asegurarInternamiento(turnoId);
        const t = obtenerTurno(turnoId);
        if (!i || !t || t.estatus !== ESTATUS.INTERNADO) return { ok: false, motivo: 'El internamiento no está activo.' };
        if (!puedeNotaPostoperatoria(s, i)) return { ok: false, motivo: 'Solo el cirujano o Dirección pueden registrar la nota post-operatoria.' };
        const v = {
            dx_pre: limpiarEspacios(entrada.dx_pre || entrada.preoperatorio),
            dx_post: limpiarEspacios(entrada.dx_post || entrada.postoperatorio),
            operacion_planeada: limpiarEspacios(entrada.operacion_planeada || entrada.operacion),
            operacion: limpiarEspacios(entrada.operacion || entrada.operacion_realizada),
            tecnica: String(entrada.tecnica || entrada.descripcion_tecnica || '').trim(),
            hallazgos: String(entrada.hallazgos || '').trim(),
            pronostico: limpiarEspacios(entrada.pronostico || entrada.estado_postquirurgico || 'Bueno para la vida y la función'),
            sangrado_ml: parseInt(String(entrada.sangrado_ml !== undefined ? entrada.sangrado_ml : (entrada.sangrado || '0')).replace(/[^0-9]/g, '') || '0', 10),
            patologia: (entrada.patologia === 'si' || entrada.patologia === true || (entrada.piezas && entrada.piezas !== 'No')) ? 'si' : 'no',
            entrada: entrada.entrada !== undefined ? !!entrada.entrada : true,
            pausa: entrada.pausa !== undefined ? !!entrada.pausa : true,
            salida: entrada.salida !== undefined ? !!entrada.salida : true,
            conteo: entrada.conteo !== undefined ? !!entrada.conteo : true,
            indicaciones: String(entrada.indicaciones || entrada.plan_postoperatorio || '').trim(),
            cirujano: limpiarEspacios(entrada.cirujano),
            ayudante: limpiarEspacios(entrada.ayudante),
            instrumentista: limpiarEspacios(entrada.instrumentista),
            anestesiologo: limpiarEspacios(entrada.anestesiologo),
            circulante: limpiarEspacios(entrada.circulante),
            pediatra: limpiarEspacios(entrada.pediatra)
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
        const cargarBiopsia = v.patologia === 'si' && !!entrada.estudio_biopsia_id && entrada.cargar_biopsia !== false && entrada.cargar_biopsia !== 'false' && entrada.cargar_biopsia !== '0';
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
        'MID-5': { nombre_comercial: 'Relacum', forma_farmaceutica: 'SOLUCION_INYECTABLE', concentracion: '5 mg / 5 ml', via_administracion: 'IV', conservacion: 'AMBIENTE', proveedor: 'Casa Saba' },
        'PRO-200': { nombre_comercial: 'Diprivan', forma_farmaceutica: 'SOLUCION_INYECTABLE', concentracion: '200 mg / 20 ml', via_administracion: 'IV', conservacion: 'AMBIENTE', proveedor: 'Casa Saba' },
        'BUP-05': { nombre_comercial: 'Buvacaína', forma_farmaceutica: 'SOLUCION_INYECTABLE', concentracion: '15 mg / 3 ml (0.5%)', via_administracion: 'IV', conservacion: 'AMBIENTE', proveedor: 'Casa Saba' },
        'PROP-40': { nombre_comercial: 'Inderalici', forma_farmaceutica: 'TABLETA', concentracion: '40 mg / 1 mg IV', via_administracion: 'VO', conservacion: 'AMBIENTE', proveedor: 'Nadro' },
        'KET-30': { nombre_comercial: 'Dolac', forma_farmaceutica: 'SOLUCION_INYECTABLE', concentracion: '30 mg / 1 ml', via_administracion: 'IV', conservacion: 'AMBIENTE', proveedor: 'Casa Saba' },
        'OND-8': { nombre_comercial: 'Zofran', forma_farmaceutica: 'SOLUCION_INYECTABLE', concentracion: '8 mg / 4 ml', via_administracion: 'IV', conservacion: 'AMBIENTE', proveedor: 'Casa Saba' },
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
        'FEN-50': { laboratorio: 'Pisa', categoria: 'MEDICAMENTO', fraccion_cofepris: 'I', piezas_por_caja: 10, aplica_iva: false, forma_farmaceutica: 'SOLUCION_INYECTABLE', via_administracion: 'IV' },
        'MID-5': { laboratorio: 'Pisa', categoria: 'MEDICAMENTO', fraccion_cofepris: 'II', piezas_por_caja: 1, aplica_iva: false, forma_farmaceutica: 'SOLUCION_INYECTABLE', via_administracion: 'IV' },
        'PRO-200': { laboratorio: 'Pisa', categoria: 'MEDICAMENTO', fraccion_cofepris: 'IV', piezas_por_caja: 1, aplica_iva: false, forma_farmaceutica: 'SOLUCION_INYECTABLE', via_administracion: 'IV' },
        'BUP-05': { laboratorio: 'Pisa', categoria: 'MEDICAMENTO', fraccion_cofepris: 'IV', piezas_por_caja: 1, aplica_iva: false, forma_farmaceutica: 'SOLUCION_INYECTABLE', via_administracion: 'IV' },
        'PROP-40': { laboratorio: 'AstraZeneca', categoria: 'MEDICAMENTO', fraccion_cofepris: 'IV', piezas_por_caja: 1, aplica_iva: false, forma_farmaceutica: 'TABLETA', via_administracion: 'VO' },
        'KET-30': { laboratorio: 'Pisa', categoria: 'MEDICAMENTO', fraccion_cofepris: 'IV', piezas_por_caja: 1, aplica_iva: false, forma_farmaceutica: 'SOLUCION_INYECTABLE', via_administracion: 'IV' },
        'OND-8': { laboratorio: 'Pisa', categoria: 'MEDICAMENTO', fraccion_cofepris: 'IV', piezas_por_caja: 1, aplica_iva: false, forma_farmaceutica: 'SOLUCION_INYECTABLE', via_administracion: 'IV' },
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
        const loteFinal = ya || lista[lista.length - 1];
        mov.lote_id = loteFinal.lote_id; mov.saldo_lote = Number(loteFinal.stock) || 0;
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
        { estudio_id: 'EST-QS6', codigo: 'QS6', nombre: 'Química Sanguínea 6 elem. (QS6)', categoria: 'LABORATORIO', tubo_muestra: 'Tubo Rojo / Amarillo (Suero)', precio_unitario: 550, aplica_iva: true },
        { estudio_id: 'EST-ES', codigo: 'ES', nombre: 'Electrolitos Séricos (ES)', categoria: 'LABORATORIO', tubo_muestra: 'Tubo Rojo / Amarillo (Suero)', precio_unitario: 480, aplica_iva: true },
        { estudio_id: 'EST-TP-TPT', codigo: 'TP-TPT', nombre: 'Tiempos de Coagulación (TP y TPT)', categoria: 'LABORATORIO', tubo_muestra: 'Tubo Azul (Citrato)', precio_unitario: 420, aplica_iva: true },
        { estudio_id: 'EST-EGO', codigo: 'EGO', nombre: 'Examen General de Orina (EGO)', categoria: 'LABORATORIO', tubo_muestra: 'Frasco estéril (Orina)', precio_unitario: 220, aplica_iva: true },
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
                const idx = lista.findIndex(x => normalizar(x.codigo) === normalizar(s.codigo));
                if (idx < 0) { lista.push(fichaEstudio(s)); cambio = true; }
                else if (s.codigo === 'QS6' || s.codigo === 'ES') {
                    if (lista[idx].tubo_muestra !== s.tubo_muestra) { lista[idx].tubo_muestra = s.tubo_muestra; cambio = true; }
                }
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
    function normalizarFamiliaTubo(tuboRaw) {
        const t = limpiarEspacios(tuboRaw || '');
        const n = normalizar(t);
        if (!t || n === 'n/a' || n === 'na') return null;
        if (n.indexOf('lila') >= 0 || n.indexOf('edta') >= 0 || n.indexOf('morado') >= 0) {
            return { clave: 'LILA_EDTA', tubo: 'Tubo Lila (EDTA)', emoji: '🟣', consolidable: true };
        }
        if (n.indexOf('rojo') >= 0 || n.indexOf('amarillo') >= 0 || n.indexOf('suero') >= 0 || n.indexOf('gel') >= 0) {
            return { clave: 'ROJO_AMARILLO_SUERO', tubo: 'Tubo Rojo / Amarillo (Suero)', emoji: '🔴', consolidable: true };
        }
        if (n.indexOf('azul') >= 0 || n.indexOf('citrato') >= 0) {
            return { clave: 'AZUL_CITRATO', tubo: 'Tubo Azul (Citrato)', emoji: '🔵', consolidable: true };
        }
        if (n.indexOf('frasco') >= 0 && n.indexOf('formol') < 0) {
            return { clave: 'FRASCO_ORINA', tubo: 'Frasco estéril (Orina)', emoji: '🧴', consolidable: true };
        }
        if (n.indexOf('jeringa') >= 0) {
            return { clave: 'JERINGA_HEP', tubo: 'Jeringa heparinizada', emoji: '💉', consolidable: true };
        }
        return { clave: t, tubo: t, emoji: colorTubo(t), consolidable: false };
    }
    function resumenTubosEstudios(ids) {
        const grupos = {}, orden = [];
        (ids || []).forEach(id => {
            const est = estudioPorId(id) || estudioPorCodigo(id);
            const tubo = est && tuboCuenta(est.tubo_muestra);
            if (!tubo) return;
            const fam = normalizarFamiliaTubo(tubo);
            if (!fam) return;
            const etiquetaEst = est.codigo || est.nombre;
            if (!grupos[fam.clave]) {
                grupos[fam.clave] = { tubo: fam.tubo, cantidad: 1, emoji: fam.emoji, estudios: [], consolidable: fam.consolidable };
                orden.push(fam.clave);
            } else if (!fam.consolidable) {
                grupos[fam.clave].cantidad += 1;
            }
            if (etiquetaEst && grupos[fam.clave].estudios.indexOf(etiquetaEst) < 0) {
                grupos[fam.clave].estudios.push(etiquetaEst);
            }
        });
        const tubos = orden.map(k => ({
            tubo: grupos[k].tubo,
            cantidad: grupos[k].cantidad,
            emoji: grupos[k].emoji,
            estudios: grupos[k].estudios
        }));
        const texto = tubos.map(t => {
            const pref = (t.emoji ? t.emoji + ' ' : '') + t.cantidad + 'x ' + t.tubo;
            return t.estudios && t.estudios.length > 1 ? (pref + ' (para ' + t.estudios.join(', ') + ')') : pref;
        }).join(', ');
        return { tubos: tubos, texto: texto };
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
        const totalAjustado = recalcularCuentaTurno(turnoId);
        sincronizarCuentaEspejo(turnoId);
        return { ok: true, total: totalAjustado };
    }
    function sincronizarCuentaEspejo(turnoId) {
        const mapCuentas = leer(CLAVES.cuentas, {}) || {};
        if (!mapCuentas[turnoId]) return;
        const t = obtenerTurno(turnoId);
        if (!t) return;
        const cargos = cargosDeEpisodio(t);
        mapCuentas[turnoId].cargos = cargos;
        mapCuentas[turnoId].total = totalCargos(cargos);
        mapCuentas[turnoId].actualizada_en = new Date().toISOString();
        escribir(CLAVES.cuentas, mapCuentas);
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
        let piezas = parseInt(lote.piezas_por_caja, 10) || 1;
        if (lote.stock < piezas && lote.stock > 0 && listarMovimientosFarmacia().some(m => m.tipo === 'BAJA' && (m.lote_id === lote.lote_id || m.lote === lote.lote))) piezas = Math.min(piezas, Number(lote.stock));
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
        const e = Object.assign({}, entrada || {});
        if (contarLetrasTxt(String(e.valoracion || e.plan || '')) < 10) return { ok: false, errores: { valoracion: 'Escriba la valoración preanestésica (mínimo 10 letras).' }, motivo: 'Escriba la valoración preanestésica.' };
        const crudosMeds = e.medicamentos_solicitados || e.medicamentos_estimados || e.medicamentos || [];
        const medsSolicitados = [];
        crudosMeds.forEach(m => {
            if (!m || !m.sku) return;
            const cant = parseInt(m.cantidad_estimada != null ? m.cantidad_estimada : m.cantidad, 10);
            if (!Number.isInteger(cant) || cant < 1) return;
            const cat = MEDS_ANESTESIA.find(x => x.sku === m.sku) || productoPorSku(m.sku) || { sku: m.sku, nombre: m.nombre || m.sku, fraccion: m.fraccion || 'IV' };
            medsSolicitados.push({
                sku: cat.sku,
                nombre: cat.nombre,
                fraccion: cat.fraccion || cat.fraccion_cofepris || 'IV',
                cantidad_estimada: cant,
                via: limpiarEspacios(m.via || 'IV'),
                nota: limpiarEspacios(m.nota || 'Estimado preoperatorio (no descontado de caja hasta conciliación postanestésica)'),
                descontado_en_caja: false
            });
        });
        e.asa = limpiarEspacios(e.asa || 'ASA II');
        e.mallampati = limpiarEspacios(e.mallampati || 'Clase II');
        e.ayuno_horas = e.ayuno_horas != null ? e.ayuno_horas : 8;
        e.tecnica_planeada = limpiarEspacios(e.tecnica_planeada || e.tecnica_texto || e.plan || 'Sedación consciente + anestesia balanceada');
        e.medicamentos_solicitados = medsSolicitados;
        e.descontado_en_caja = false;
        const medObj = (s && USUARIOS[s.usuario_id]) || s || {};
        e.autor_especialidad = especialidadImpresaMedico(medObj) || 'Anestesiología';
        e.cedulas_impresas = textoCedulasFirma(medObj);
        return guardarHojaAnestesia('notas_preanestesicas', 'PRE', turnoId, e, s);
    }
    function guardarRegistroTransanestesico(turnoId, entrada, s) {
        const e = entrada || {};
        const lleno = v => Array.isArray(v) ? v.some(x => x && (typeof x !== 'object' || Object.values(x).some(y => String(y == null ? '' : y).trim()))) : (v != null && typeof v === 'object' ? Object.values(v).some(y => String(y == null ? '' : y).trim()) : String(v == null ? '' : v).trim() !== '');
        if (!['signos_trans', 'medicamentos_trans', 'liquidos_trans', 'eventos', 'notas', 'signos', 'medicamentos', 'liquidos', 'texto', 'valoracion'].some(k => lleno(e[k]))) return { ok: false, motivo: 'Capture al menos signos, medicamentos, líquidos, eventos o notas del registro transanestésico.' };
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
        const tHe = obtenerTurno(turnoId);
        if (!tHe) return { ok: false, motivo: 'No se encontró el episodio.' };
        if (s.rol === 'medico') {
            const iHe = internamientoDeTurno(turnoId);
            const vinculado = relacionMedico(iHe, tHe, s) || listarCirugias().some(c => (c.turno_id === turnoId || (c.paciente_id && c.paciente_id === tHe.paciente_id)) && (c.medico_cirujano_id === s.medico_id || c.anestesiologo_id === s.medico_id));
            if (!vinculado) return { ok: false, motivo: 'Solo el médico tratante, interconsultante, cirujano o anestesiólogo de este paciente puede escribir en la Hoja de Enfermería.' };
        }
        const d = datos || {};
        const glFuera = (d.signos || []).find(x => x && x.glucosa_mg_dl !== '' && x.glucosa_mg_dl != null && Number.isFinite(Number(x.glucosa_mg_dl)) && (Number(x.glucosa_mg_dl) < 20 || Number(x.glucosa_mg_dl) > 600));
        if (glFuera) return { ok: false, motivo: 'La glucosa capilar debe estar entre 20 y 600 mg/dL.' };
        const h = obtenerHojaEnfermeria(turnoId);
        const sello = { usuario_id: s.usuario_id, usuario_nombre: s.nombre, registrado_en: new Date().toISOString() };
        (d.kardex || []).forEach(k => { if (limpiarEspacios(k.medicamento)) h.kardex.push(Object.assign({ id: uid('KDX'), hora: k.hora || '' }, k, sello)); });
        (d.signos || []).forEach(x => {
            const turno = String(x.turno || '').toUpperCase();
            if (TURNOS_ENFERMERIA.indexOf(turno) < 0) return;
            h.signos.push(Object.assign({ id: uid('SVE') }, x, { turno: turno, glucosa_mg_dl: x.glucosa_mg_dl === '' || x.glucosa_mg_dl == null || !Number.isFinite(Number(x.glucosa_mg_dl)) ? null : Number(x.glucosa_mg_dl) }, sello));
        });
        const bal = d.balance || {};
        ['ingresos', 'egresos'].forEach(k => (bal[k] || []).forEach(x => { if (Number(x.ml) > 0) h.balance[k].push(Object.assign({ id: uid('BH') }, x, { ml: Number(x.ml) }, sello)); }));
        if (d.observaciones != null && String(d.observaciones).trim()) {
            h.observaciones = String(d.observaciones);
            h.bitacora_observaciones = (h.bitacora_observaciones || []).concat([Object.assign({ id: uid('OBS'), texto: String(d.observaciones) }, sello)]);
        }
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
        const detallePrevio = limpiarEspacios(o.detalle || o.observaciones || '');
        if (motivo === 'OTRO' && detallePrevio.length < 5) return { ok: false, motivo: 'Para el motivo "Otro" escriba la justificación (mínimo 5 caracteres).' };
        if (lote.fraccion_cofepris === 'I' && !limpiarEspacios(o.folio_acta || o.testigo || o.acta_cofepris || '')) return { ok: false, motivo: 'La baja de un medicamento de Fracción I requiere folio de acta COFEPRIS o testigo.' };
        lote.stock = Number(lote.stock) - cant;
        if (!escribir(CLAVES.farmacia, catalogo)) return { ok: false, motivo: 'No se pudo actualizar el inventario.' };
        const detalle = limpiarEspacios(o.detalle || o.observaciones || '');
        const ahora = new Date().toISOString();
        const registro = {
            salida_id: uid('BAJA'), tipo: 'baja', tipo_movimiento: 'BAJA_' + motivo, motivo: motivo, detalle: detalle,
            lote_id: lote.lote_id, sku: lote.sku, nombre: denominacionProducto(lote), lote: lote.lote, caducidad: lote.caducidad,
            folio_acta: limpiarEspacios(o.folio_acta || o.acta_cofepris || ''), testigo: limpiarEspacios(o.testigo || ''),
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
    function fichaPacienteReceta(pacienteId, turno, extra) {
        const p = buscarPacientePorId(pacienteId) || {};
        const i = turno ? internamientoDeTurno(turno.turno_id) : null;
        const sv = (turno && turno.signos_vitales) || {};
        const ex = extra || {};
        const fn = p.fecha_nacimiento || (turno && turno.fecha_nacimiento) || '';
        const alergiaCruda = ex.alergias || (i && i.alergias) || (turno && alergiasDeBorrador(turno.turno_id)) || p.alergias || '';
        const alergiaLimpia = (!alergiaCruda || /^ninguna|^negada|^sin alergia/i.test(String(alergiaCruda).trim())) ? 'NEGADAS' : String(alergiaCruda).trim();
        return {
            paciente_id: pacienteId || null,
            paciente_nombre: p.nombre_completo || (turno && turno.paciente_nombre) || '',
            paciente_edad: fn ? formatearEdad(fn) : null,
            paciente_fecha_nacimiento: fn,
            paciente_nacionalidad: p.nacionalidad || 'Mexicana',
            paciente_telefono: p.telefono || '',
            paciente_direccion: p.direccion || '',
            paciente_peso: ex.peso != null && ex.peso !== '' ? ex.peso : (sv.peso_kg != null && sv.peso_kg !== '' ? sv.peso_kg : (sv.peso != null && sv.peso !== '' ? sv.peso : '')),
            paciente_talla: ex.talla != null && ex.talla !== '' ? ex.talla : (sv.talla_m != null && sv.talla_m !== '' ? sv.talla_m : (sv.talla != null && sv.talla !== '' ? sv.talla : '')),
            paciente_alergias: alergiaLimpia
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
            medico_especialidad: especialidadImpresaMedico(medico) || (especialidadPorCodigo(medico.especialidad_codigo) || {}).nombre || medico.cargo || (s && s.especialidad) || '',
            cedulas_impresas: textoCedulasFirma(medico),
            diagnostico: limpiarEspacios((entrada && entrada.diagnostico) || (t && t.dx_principal) || ''),
            items: items,
            estatus_surtido: 'PENDIENTE'
        }, fichaPacienteReceta(pacienteId, t, entrada));
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
            const textoBusq = limpiarEspacios(crudo.nombre || crudo.nombre_libre || "");
            const prod = (crudo.sku ? productoPorSku(crudo.sku) : null) || (textoBusq ? (buscarMedicamentosReceta(textoBusq) || [])[0] : null);
            if ((tipo === 'RECETA_CASA' || tipo === 'APLICACION_CONSULTA') && !prod) {
                const nombre = limpiarEspacios(crudo.nombre || crudo.nombre_libre);
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
    function detectarFraccionItemReceta(item) {
        if (!item) return 'VI';
        if (item.fraccion_cofepris && item.fraccion_cofepris !== 'NA') return item.fraccion_cofepris;
        const txt = normalizar([item.nombre, item.dosis_indicacion, item.sku].filter(Boolean).join(' '));
        if (/fentanil|morfina|metadona|oxicodona|petidina/.test(txt)) return 'I';
        if (/diazepam|clonazepam|alprazolam|lorazepam|midazolam|tramadol|buprenorfina|fenobarbital|zolpidem|metilfenidato|codeina|pregabalina|ketamina|tiopental/.test(txt)) return 'II';
        if (/amoxicilina|ceftriaxona|cefalexina|cefuroxima|cefotaxima|cefixima|ciprofloxacino|levofloxacino|moxifloxacino|azitromicina|claritromicina|eritromicina|clindamicina|metronidazol|trimetoprima|sulfametoxazol|ampicilina|dicloxacilina|meropenem|imipenem|ertapenem|gentamicina|amikacina|vancomicina|linezolid|doxiciclina|nitrofurantoina|fosfomicina/.test(txt)) return 'IV_ANTIBIOTICO';
        return 'VI';
    }
    function numeroALetrasSimple(n) {
        const num = parseInt(n, 10);
        const mapa = { 1: 'UN', 2: 'DOS', 3: 'TRES', 4: 'CUATRO', 5: 'CINCO', 6: 'SEIS', 7: 'SIETE', 8: 'OCHO', 9: 'NUEVE', 10: 'DIEZ', 12: 'DOCE', 14: 'CATORCE', 15: 'QUINCE', 20: 'VEINTE', 21: 'VEINTIÚN', 28: 'VEINTIOCHO', 30: 'TREINTA' };
        return mapa[num] || String(Number.isFinite(num) ? num : 1);
    }
    function htmlHojaReceta(receta) {
        if (!receta) return '';
        const base = modeloRecetaOficial(receta);
        const items = Array.isArray(receta.items) ? receta.items : [];
        if ((!receta.tipo_origen || receta.tipo_origen === 'RECETA_CASA') && items.length > 1) {
            const controlados = [];
            const ordinarios = [];
            items.forEach((it, idx) => {
                const fr = detectarFraccionItemReceta(it);
                const medObj = base.medicamentos[idx] || {
                    nombre: it.nombre || '',
                    presentacion: [it.concentracion, nombreFormaFarmaceutica(it.forma_farmaceutica) || it.forma_farmaceutica].filter(Boolean).join(' · '),
                    cantidad: it.cantidad_prescrita != null ? it.cantidad_prescrita : (it.cantidad || 1),
                    instrucciones: it.dosis_indicacion || ''
                };
                if (fr === 'I' || fr === 'II' || fr === 'III') {
                    controlados.push({ item: it, med: medObj, fraccion: fr });
                } else {
                    ordinarios.push(medObj);
                }
            });
            if (controlados.length > 0 && ordinarios.length > 0) {
                const hojas = [];
                hojas.push(htmlRecetaCarta(Object.assign({}, base, { medicamentos: ordinarios })));
                controlados.forEach((ctrl, cIdx) => {
                    const cantNum = parseInt(ctrl.med.cantidad, 10) || 1;
                    const cantLetras = cantNum + ' (' + numeroALetrasSimple(cantNum) + ') ENVASE(S) / CAJA(S)';
                    const medCtrl = Object.assign({}, ctrl.med, {
                        cantidad: cantLetras,
                        instrucciones: (ctrl.med.instrucciones || '') + '\n[RECETA EXCLUSIVA DE MEDICAMENTO CONTROLADO — FRACCIÓN ' + ctrl.fraccion + ' COFEPRIS / LGS · Retener / Sellar en Farmacia]'
                    });
                    const hojaCtrl = htmlRecetaCarta(Object.assign({}, base, {
                        folio: (base.folio || 'REC') + '-CTRL-' + (cIdx + 1),
                        subtitulo_normativo: 'RECETA ESPECIAL INDIVIDUAL — MEDICAMENTO CONTROLADO FRACCIÓN ' + ctrl.fraccion + ' (LGS ART. 226 / COFEPRIS)',
                        medicamentos: [medCtrl]
                    }));
                    hojas.push('<div style="page-break-before:always;break-before:page;margin-top:16px;">' + hojaCtrl + '</div>');
                });
                return hojas.join('');
            }
        }
        return htmlRecetaCarta(base);
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
            const cantTxt = (med.cantidad !== undefined && med.cantidad !== null && String(med.cantidad) !== '') ? ('Cant.: ' + med.cantidad) : '';
            const cabeza = [med.nombre, med.presentacion, cantTxt].filter(x => x !== undefined && x !== null && String(x) !== '').join(' · ');
            return '<div style="margin:0 0 12px;"><p style="margin:0;font-weight:bold;">' + (i + 1) + '. ' + e(cabeza) + '</p><p style="margin:3px 0 0 18px;white-space:pre-wrap;">' + e(med.instrucciones || '') + '</p></div>';
        }).join('') : '<p style="margin:0;">&nbsp;</p>';
        const cedulasLimpias = String(m.cedulas || '').replace(/Cédula de Médico General \/ Licenciatura/gi, 'Céd. Prof.');
        const cedulas = e(cedulasLimpias).replace(/\n/g, '<br>');
        const alergiasTxt = limpiarEspacios(m.alergias || '') || 'NEGADAS';
        const tienePeso = m.peso && String(m.peso).trim() !== '' && !/^0+(\.0+)?\s*(kg)?$/i.test(String(m.peso).trim());
        const tieneTalla = m.talla && String(m.talla).trim() !== '' && !/^0+(\.0+)?\s*(m|cm)?$/i.test(String(m.talla).trim());
        return '<article style="font-family:Arial,sans-serif;color:#000;width:100%;max-width:19.5cm;margin:0 auto;font-size:12px;line-height:1.35;display:flex;flex-direction:column;min-height:21cm;box-sizing:border-box;">'
            + '<header><div style="display:grid;grid-template-columns:90px 1fr 140px;align-items:center;gap:10px;border-bottom:1.5px solid #0b3a5b;padding-bottom:8px;">'
            + '<div></div>'
            + '<div style="text-align:center;"><div style="font-weight:bold;font-size:13px;">' + e(m.medico || '') + '</div>'
            + '<div style="font-size:11px;font-weight:bold;color:#1e293b;">' + e(m.especialidad || '') + '</div>'
            + '<div style="font-size:10px;white-space:pre-line;margin-top:2px;">' + e(cedulasLimpias) + '</div></div>'
            + '<div style="text-align:right;font-size:11px;"><div><strong>Folio:</strong> ' + e(m.folio || '') + '</div><div><strong>Exp:</strong> ' + e(m.expediente || '') + '</div></div></div>'
            + '<div style="margin-top:12px;">'
            + '<div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:8px;"><span style="flex:1;">' + dato('Nombre del Paciente:', m.paciente, '68%') + '</span><span>' + dato('Fecha:', m.fecha, '120px') + '</span></div>'
            + '<div style="display:flex;flex-wrap:wrap;gap:8px 14px;margin-bottom:8px;">' + dato('Fecha de Nacimiento:', m.fecha_nacimiento, '130px') + dato('Edad:', m.edad, '90px') + (tienePeso ? dato('Peso:', m.peso, '65px') : '') + (tieneTalla ? dato('Talla:', m.talla, '65px') : '') + '</div>'
            + '<div>' + dato('Alergias:', alergiasTxt, '80%') + '</div></div></header>'
            + '<div style="position:relative;flex:1;min-height:10cm;margin-top:16px;">' + marcaAguaReceta() + '<div style="position:relative;">' + meds + '</div></div>'
            + (m.subtitulo_normativo ? '<div style="margin:6px 0;background:#fef2f2;border:1px solid #dc2626;color:#991b1b;font-size:10px;font-weight:bold;text-align:center;padding:3px 8px;border-radius:4px;">' + e(m.subtitulo_normativo) + '</div>' : '')
            + '<footer style="margin-top:14px;page-break-inside:avoid;break-inside:avoid;"><div style="text-align:center;margin-bottom:6px;"><div style="display:inline-block;min-width:260px;border-top:1px solid #000;padding-top:4px;font-size:11px;"><strong>' + e(m.medico || '') + '</strong><br>' + (m.especialidad ? ('<span style="font-size:10px;">' + e(m.especialidad) + '</span><br>') : '') + cedulas + '<br><span style="font-size:9px;color:#475569;">Firma autógrafa del médico prescriptor (NOM-004-SSA3-2012 / LGS Art. 226)</span></div></div>'
            + '</footer></article>';
    }
    function modeloRecetaOficial(receta) {
        const pac = receta.paciente_id ? buscarPacientePorId(receta.paciente_id) : null;
        const turno = receta.turno_id ? obtenerTurno(receta.turno_id) : null;
        const internamiento = (receta.internamiento_id && obtenerInternamiento(receta.internamiento_id)) || (turno && internamientoDeTurno(turno.turno_id));
        const medico = (receta.medico_id && USUARIOS[receta.medico_id]) || null;
        const esp = medico && especialidadPorCodigo(medico.especialidad_codigo);
        const sv = (turno && turno.signos_vitales) || {};
        const fn = (pac && pac.fecha_nacimiento) || (turno && turno.fecha_nacimiento) || receta.paciente_fecha_nacimiento || '';
        const edadN = (receta.paciente_edad !== null && receta.paciente_edad !== undefined && receta.paciente_edad !== '') ? receta.paciente_edad : (fn ? calcularEdad(fn) : null);
        const peso = (receta.paciente_peso !== '' && receta.paciente_peso != null) ? receta.paciente_peso : (sv.peso_kg != null ? sv.peso_kg : (sv.peso != null ? sv.peso : ''));
        const talla = (receta.paciente_talla !== '' && receta.paciente_talla != null) ? receta.paciente_talla : (sv.talla_m != null ? sv.talla_m : (sv.talla != null ? sv.talla : ''));
        const espImpresa = especialidadImpresaMedico(medico) || receta.medico_especialidad || (esp && esp.nombre) || (medico && medico.cargo) || '';
        return {
            folio: receta.folio || '',
            subtitulo_normativo: receta.subtitulo_normativo || '',
            expediente: receta.paciente_id || (turno && turno.paciente_id) || '',
            medico: receta.medico_nombre || (medico && medico.nombre) || '',
            especialidad: espImpresa,
            cedulas: textoCedulasFirma(medico) || receta.cedulas_impresas || '',
            paciente: (pac && pac.nombre_completo) || receta.paciente_nombre || '',
            fecha: fechaHoraLegible(receta.fecha_hora),
            fecha_nacimiento: fn ? fechaLegibleISO(fn) : '',
            edad: formatearEdad(fn, edadN),
            peso: conUnidadReceta(peso, 'kg', 'kg'),
            talla: conUnidadReceta(talla, 'm', 'm'),
            alergias: limpiarEspacios(receta.paciente_alergias || (internamiento && internamiento.alergias) || '') || 'NEGADAS',
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
            cedulas: d.cedulas_texto || (d.cedula ? ('Céd. Prof.: ' + d.cedula) : ''),
            paciente: d.paciente || '',
            fecha: fechaHoraLegible(d.fecha),
            fecha_nacimiento: d.fecha_nacimiento || '',
            edad: d.edad || '',
            peso: conUnidadReceta(d.peso, 'kg', 'kg'),
            talla: conUnidadReceta(d.talla, 'm', 'm'),
            alergias: limpiarEspacios(d.alergias || '') || 'NEGADAS',
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
            { lote_id: 'LOT-FEN-1', sku: 'FEN-50', nombre: 'Fentanilo 0.5 mg / 10 ml (Fracción I)', lote: 'L-FEN-26A', caducidad: isoMasDias(500), stock: 5, precio_unitario: 180, piezas_por_caja: 10 },
            { lote_id: 'LOT-MID-1', sku: 'MID-5', nombre: 'Midazolam 5 mg / 5 ml (Fracción II)', lote: 'L-MID-26A', caducidad: isoMasDias(400), stock: 24, precio_unitario: 40 },
            { lote_id: 'LOT-PRO-1', sku: 'PRO-200', nombre: 'Propofol 200 mg / 20 ml (Fracción IV)', lote: 'L-PRO-26A', caducidad: isoMasDias(300), stock: 20, precio_unitario: 95 },
            { lote_id: 'LOT-BUP-1', sku: 'BUP-05', nombre: 'Bupivacaína pesada 0.5% 15 mg / 3 ml (Fracción IV)', lote: 'L-BUP-26A', caducidad: isoMasDias(400), stock: 20, precio_unitario: 55 },
            { lote_id: 'LOT-PROP-1', sku: 'PROP-40', nombre: 'Propranolol 40 mg / 1 mg IV (Fracción IV)', lote: 'L-PRP-26A', caducidad: isoMasDias(450), stock: 25, precio_unitario: 65 },
            { lote_id: 'LOT-KET-1', sku: 'KET-30', nombre: 'Ketorolaco 30 mg / 1 ml IV (Fracción IV)', lote: 'L-KET-26A', caducidad: isoMasDias(450), stock: 30, precio_unitario: 55 },
            { lote_id: 'LOT-OND-1', sku: 'OND-8', nombre: 'Ondansetrón 8 mg / 4 ml IV (Fracción IV)', lote: 'L-OND-26A', caducidad: isoMasDias(450), stock: 25, precio_unitario: 75 },
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
            { paquete_id: 'PAQ-INYECCION', nombre: 'Inyección (Jeringa + Aguja / Aplicación)', items: [
                { sku: 'JER-10', cantidad: 1 }, { sku: 'GUA-M', cantidad: 1 }
            ] },
            { paquete_id: 'PAQ-CANALIZACION', nombre: 'Canalización IV (Punzocat + Venoclisis + Solución)', items: [
                { sku: 'PUN-18', cantidad: 1 }, { sku: 'VEN-18', cantidad: 1 }, { sku: 'SOL-1000', cantidad: 1 }, { sku: 'GUA-M', cantidad: 1 }
            ] },
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
            piezas_por_caja: lote.piezas_por_caja || 10, usadas: 0, folio_receta_especial: 'RE-2026-0142',
            area_destino: 'QUIROFANO', caducidad: lote.caducidad,
            responsable_id: 'dra_elena', responsable_nombre: (USUARIOS.dra_elena || {}).nombre || 'Dra. Elena Ríos',
            creada_en: new Date().toISOString(), usos: []
        }];
    }
    function asegurarMedsAnestesia() {
        const extras = [
            { lote_id: 'LOT-MID-1', sku: 'MID-5', nombre: 'Midazolam 5 mg / 5 ml (Fracción II)', lote: 'L-MID-26A', caducidad: isoMasDias(400), stock: 24, precio_unitario: 40 },
            { lote_id: 'LOT-PRO-1', sku: 'PRO-200', nombre: 'Propofol 200 mg / 20 ml (Fracción IV)', lote: 'L-PRO-26A', caducidad: isoMasDias(300), stock: 20, precio_unitario: 95 },
            { lote_id: 'LOT-BUP-1', sku: 'BUP-05', nombre: 'Bupivacaína pesada 0.5% 15 mg / 3 ml (Fracción IV)', lote: 'L-BUP-26A', caducidad: isoMasDias(400), stock: 20, precio_unitario: 55 },
            { lote_id: 'LOT-PROP-1', sku: 'PROP-40', nombre: 'Propranolol 40 mg / 1 mg IV (Fracción IV)', lote: 'L-PRP-26A', caducidad: isoMasDias(450), stock: 25, precio_unitario: 65 },
            { lote_id: 'LOT-KET-1', sku: 'KET-30', nombre: 'Ketorolaco 30 mg / 1 ml IV (Fracción IV)', lote: 'L-KET-26A', caducidad: isoMasDias(450), stock: 30, precio_unitario: 55 },
            { lote_id: 'LOT-OND-1', sku: 'OND-8', nombre: 'Ondansetrón 8 mg / 4 ml IV (Fracción IV)', lote: 'L-OND-26A', caducidad: isoMasDias(450), stock: 25, precio_unitario: 75 }
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


    // ---------------------------------------------------------------- Catálogo CIE-10 Integrado y Caso Real (Google Drive)
    const DATOS_CORPORATIVOS_BELEN = {
        razon_social: 'SANATORIO BELÉN S.A. DE C.V.',
        rfc: 'SBE0904239J3',
        escritura_publica: '18,599 (17 de abril de 2009 · Notaría Pública No. 5, Puerto Vallarta, Jal.)',
        representante_legal: 'Héctor Alfonso López Rodríguez',
        administrador_general: 'Lic. Alfonso Maximiano López Vargas',
        domicilio: 'Josefa Ortiz de Domínguez #189, Col. Pitillal Centro, C.P. 48290, Puerto Vallarta, Jalisco',
        telefono: '(322) 224 0564',
        whatsapp: '322 174 2776',
        email: 'clin_belen@hotmail.com',
        profeco_registro: 'Contrato de Adhesión PROFECO No. 6648-2023 · Exp. PFC.B.E.7/006661-2023 (19/jul/2023)',
        responsable_farmacia: 'T.E. María Concepción Rodríguez Rodríguez'
    };

    const CATALOGO_CIE10 = [
        // Ginecología y Obstetricia
        { codigo: 'Z34.0', nombre: 'Supervisión de primer embarazo normal', categoria: 'Gineco-Obstetricia' },
        { codigo: 'Z34.8', nombre: 'Supervisión de otros embarazos normales', categoria: 'Gineco-Obstetricia' },
        { codigo: 'Z34.9', nombre: 'Supervisión de embarazo normal, no especificado', categoria: 'Gineco-Obstetricia' },
        { codigo: 'Z35.9', nombre: 'Supervisión de embarazo de alto riesgo, sin otra especificación', categoria: 'Gineco-Obstetricia' },
        { codigo: 'O20.0', nombre: 'Amenaza de aborto', categoria: 'Gineco-Obstetricia' },
        { codigo: 'O03.9', nombre: 'Aborto espontáneo completo o no especificado, sin complicación', categoria: 'Gineco-Obstetricia' },
        { codigo: 'O02.1', nombre: 'Aborto retenido (huevo muerto retenido)', categoria: 'Gineco-Obstetricia' },
        { codigo: 'O21.0', nombre: 'Hiperémesis gravídica leve', categoria: 'Gineco-Obstetricia' },
        { codigo: 'O23.4', nombre: 'Infección no especificada de las vías urinarias en el embarazo', categoria: 'Gineco-Obstetricia' },
        { codigo: 'O24.4', nombre: 'Diabetes mellitus que se origina en el embarazo (gestacional)', categoria: 'Gineco-Obstetricia' },
        { codigo: 'O13', nombre: 'Hipertensión gestacional sin proteinuria significativa', categoria: 'Gineco-Obstetricia' },
        { codigo: 'O14.0', nombre: 'Preeclampsia leve a moderada', categoria: 'Gineco-Obstetricia' },
        { codigo: 'O14.1', nombre: 'Preeclampsia severa (con datos de severidad)', categoria: 'Gineco-Obstetricia' },
        { codigo: 'O47.0', nombre: 'Falso trabajo de parto antes de las 37 semanas completas de gestación', categoria: 'Gineco-Obstetricia' },
        { codigo: 'O60.0', nombre: 'Trabajo de parto prematuro sin parto (amenaza de parto pretérmino)', categoria: 'Gineco-Obstetricia' },
        { codigo: 'O80.9', nombre: 'Parto único espontáneo, sin otra especificación', categoria: 'Gineco-Obstetricia' },
        { codigo: 'O82.9', nombre: 'Parto por cesárea, sin otra especificación', categoria: 'Gineco-Obstetricia' },
        { codigo: 'O99.0', nombre: 'Anemia que complica el embarazo, el parto y el puerperio', categoria: 'Gineco-Obstetricia' },
        { codigo: 'N76.0', nombre: 'Vaginitis aguda / Cervicovaginitis', categoria: 'Gineco-Obstetricia' },
        { codigo: 'N72', nombre: 'Enfermedad inflamatoria del cuello uterino (cervicitis)', categoria: 'Gineco-Obstetricia' },
        { codigo: 'N73.9', nombre: 'Enfermedad inflamatoria pélvica femenina (EIP)', categoria: 'Gineco-Obstetricia' },
        { codigo: 'N80.9', nombre: 'Endometriosis, no especificada', categoria: 'Gineco-Obstetricia' },
        { codigo: 'D25.9', nombre: 'Leiomioma del útero (miomatosis uterina)', categoria: 'Gineco-Obstetricia' },
        { codigo: 'N83.2', nombre: 'Otros quistes ováricos y los no especificados', categoria: 'Gineco-Obstetricia' },
        { codigo: 'E28.2', nombre: 'Síndrome de ovario poliquístico (SOP)', categoria: 'Gineco-Obstetricia' },
        { codigo: 'N92.0', nombre: 'Menstruación excesiva y frecuente con ciclo regular (menorragia)', categoria: 'Gineco-Obstetricia' },
        { codigo: 'N93.9', nombre: 'Hemorragia vaginal y uterina anormal, no especificada', categoria: 'Gineco-Obstetricia' },
        { codigo: 'N94.6', nombre: 'Dismenorrea, no especificada', categoria: 'Gineco-Obstetricia' },
        { codigo: 'Z30.2', nombre: 'Esterilización (Salpingoclasia / OTB / Vasectomía)', categoria: 'Gineco-Obstetricia' },

        // Medicina General, Infecciosas y Respiratorias
        { codigo: 'J00', nombre: 'Rinofaringitis aguda (resfriado común)', categoria: 'Respiratorio' },
        { codigo: 'J02.9', nombre: 'Faringitis aguda, no especificada', categoria: 'Respiratorio' },
        { codigo: 'J03.9', nombre: 'Amigdalitis aguda / Faringoamigdalitis aguda', categoria: 'Respiratorio' },
        { codigo: 'J01.9', nombre: 'Sinusitis aguda, no especificada', categoria: 'Respiratorio' },
        { codigo: 'J04.0', nombre: 'Laringitis aguda', categoria: 'Respiratorio' },
        { codigo: 'J06.9', nombre: 'Infección aguda de las vías respiratorias superiores', categoria: 'Respiratorio' },
        { codigo: 'J18.9', nombre: 'Neumonía, no especificada', categoria: 'Respiratorio' },
        { codigo: 'J20.9', nombre: 'Bronquitis aguda, no especificada', categoria: 'Respiratorio' },
        { codigo: 'J44.1', nombre: 'Enfermedad pulmonar obstructiva crónica (EPOC) con exacerbación aguda', categoria: 'Respiratorio' },
        { codigo: 'J45.9', nombre: 'Asma, no especificada / Crisis asmática', categoria: 'Respiratorio' },
        { codigo: 'H66.9', nombre: 'Otitis media, no especificada', categoria: 'ORL' },
        { codigo: 'H60.9', nombre: 'Otitis externa, no especificada', categoria: 'ORL' },
        { codigo: 'H10.9', nombre: 'Conjuntivitis, no especificada', categoria: 'Oftalmología' },
        { codigo: 'A09.9', nombre: 'Gastroenteritis y colitis infecciosa (GEPI)', categoria: 'Gastroenterología' },
        { codigo: 'A09.0', nombre: 'Otras gastroenteritis y colitis de origen infeccioso', categoria: 'Gastroenterología' },
        { codigo: 'A90', nombre: 'Fiebre del dengue [dengue clásico / sin datos de alarma]', categoria: 'Infecciosas' },
        { codigo: 'A91', nombre: 'Fiebre del dengue hemorrágico / Dengue con signos de alarma', categoria: 'Infecciosas' },
        { codigo: 'B34.9', nombre: 'Infección viral, no especificada', categoria: 'Infecciosas' },
        { codigo: 'U07.1', nombre: 'COVID-19, virus identificado', categoria: 'Infecciosas' },

        // Gastroenterología y Cirugía General
        { codigo: 'K21.9', nombre: 'Enfermedad del reflujo gastroesofágico (ERGE)', categoria: 'Gastroenterología' },
        { codigo: 'K29.7', nombre: 'Gastritis, no especificada', categoria: 'Gastroenterología' },
        { codigo: 'K29.1', nombre: 'Otras gastritis agudas', categoria: 'Gastroenterología' },
        { codigo: 'K30', nombre: 'Dispepsia funcional', categoria: 'Gastroenterología' },
        { codigo: 'K35.8', nombre: 'Apendicitis aguda', categoria: 'Cirugía General' },
        { codigo: 'K40.9', nombre: 'Hernia inguinal unilateral o no especificada, sin obstrucción ni gangrena', categoria: 'Cirugía General' },
        { codigo: 'K42.9', nombre: 'Hernia umbilical sin obstrucción ni gangrena', categoria: 'Cirugía General' },
        { codigo: 'K43.9', nombre: 'Hernia ventral / postincisional', categoria: 'Cirugía General' },
        { codigo: 'K58.9', nombre: 'Síndrome del intestino irritable (colitis nerviosa)', categoria: 'Gastroenterología' },
        { codigo: 'K59.0', nombre: 'Constipación (estreñimiento)', categoria: 'Gastroenterología' },
        { codigo: 'K60.2', nombre: 'Fisura anal, no especificada', categoria: 'Cirugía General' },
        { codigo: 'K61.0', nombre: 'Absceso anal / perianal', categoria: 'Cirugía General' },
        { codigo: 'K64.9', nombre: 'Hemorroides, sin otra especificación', categoria: 'Cirugía General' },
        { codigo: 'K80.0', nombre: 'Cálculo de la vesícula biliar con colecistitis aguda', categoria: 'Cirugía General' },
        { codigo: 'K80.2', nombre: 'Cálculo de la vesícula biliar sin colecistitis (colelitiasis)', categoria: 'Cirugía General' },
        { codigo: 'K81.0', nombre: 'Colecistitis aguda', categoria: 'Cirugía General' },
        { codigo: 'K85.9', nombre: 'Pancreatitis aguda, no especificada', categoria: 'Cirugía General' },
        { codigo: 'L02.9', nombre: 'Absceso cutáneo, furúnculo y ántrax de sitio no especificado', categoria: 'Cirugía General' },
        { codigo: 'L03.9', nombre: 'Celulitis de sitio no especificado', categoria: 'Cirugía General' },
        { codigo: 'D17.9', nombre: 'Lipoma (tumor benigno del tejido adiposo)', categoria: 'Cirugía General' },

        // Cardiología, Medicina Interna y Endocrinología
        { codigo: 'I10', nombre: 'Hipertensión esencial (primaria)', categoria: 'Cardiología / Med. Interna' },
        { codigo: 'I11.9', nombre: 'Enfermedad cardíaca hipertensiva sin insuficiencia cardíaca', categoria: 'Cardiología / Med. Interna' },
        { codigo: 'I20.9', nombre: 'Angina de pecho, no especificada', categoria: 'Cardiología / Med. Interna' },
        { codigo: 'I21.9', nombre: 'Infarto agudo del miocardio, sin otra especificación', categoria: 'Cardiología / Med. Interna' },
        { codigo: 'I48.9', nombre: 'Fibrilación y aleteo auricular', categoria: 'Cardiología / Med. Interna' },
        { codigo: 'I50.9', nombre: 'Insuficiencia cardíaca, no especificada', categoria: 'Cardiología / Med. Interna' },
        { codigo: 'I83.9', nombre: 'Venas varicosas de los miembros inferiores (insuficiencia venosa)', categoria: 'Angiología' },
        { codigo: 'I80.2', nombre: 'Trombosis venosa profunda (TVP) de miembros inferiores', categoria: 'Angiología' },
        { codigo: 'E11.9', nombre: 'Diabetes mellitus tipo 2 sin mención de complicación', categoria: 'Medicina Interna' },
        { codigo: 'E11.8', nombre: 'Diabetes mellitus tipo 2 con complicaciones no especificadas (descontrolada)', categoria: 'Medicina Interna' },
        { codigo: 'E11.5', nombre: 'Diabetes mellitus tipo 2 con complicaciones circulatorias periféricas (pie diabético)', categoria: 'Medicina Interna' },
        { codigo: 'E03.9', nombre: 'Hipotiroidismo, no especificado', categoria: 'Medicina Interna' },
        { codigo: 'E05.9', nombre: 'Tirotoxicosis (hipertiroidismo), no especificada', categoria: 'Medicina Interna' },
        { codigo: 'E66.9', nombre: 'Obesidad, no especificada', categoria: 'Medicina Interna' },
        { codigo: 'E78.0', nombre: 'Hipercolesterolemia pura', categoria: 'Medicina Interna' },
        { codigo: 'E78.2', nombre: 'Hiperlipidemia mixta (dislipidemia)', categoria: 'Medicina Interna' },
        { codigo: 'E86', nombre: 'Depleción del volumen (deshidratación)', categoria: 'Medicina Interna' },
        { codigo: 'D50.9', nombre: 'Anemia por deficiencia de hierro, sin otra especificación', categoria: 'Medicina Interna' },

        // Urología y Nefrología
        { codigo: 'N39.0', nombre: 'Infección de vías urinarias (IVU), sitio no especificado', categoria: 'Urología' },
        { codigo: 'N30.0', nombre: 'Cistitis aguda', categoria: 'Urología' },
        { codigo: 'N10', nombre: 'Nefritis tubulointersticial aguda (Pielonefritis aguda)', categoria: 'Urología' },
        { codigo: 'N20.0', nombre: 'Cálculo del riñón (nefrolitiasis)', categoria: 'Urología' },
        { codigo: 'N23', nombre: 'Cólico renal, no especificado (cólico nefrítico)', categoria: 'Urología' },
        { codigo: 'N40', nombre: 'Hiperplasia de la próstata (HPB)', categoria: 'Urología' },
        { codigo: 'N17.9', nombre: 'Insuficiencia renal aguda, no especificada', categoria: 'Nefrología' },
        { codigo: 'N18.9', nombre: 'Enfermedad renal crónica, no especificada', categoria: 'Nefrología' },

        // Traumatología y Ortopedia
        { codigo: 'M54.5', nombre: 'Lumbago no especificado (lumbalgia)', categoria: 'Traumatología y Ortopedia' },
        { codigo: 'M54.4', nombre: 'Lumbago con ciática (lumbociatalgia)', categoria: 'Traumatología y Ortopedia' },
        { codigo: 'M54.2', nombre: 'Cervicalgia', categoria: 'Traumatología y Ortopedia' },
        { codigo: 'M17.9', nombre: 'Gonartrosis, no especificada (artrosis de rodilla)', categoria: 'Traumatología y Ortopedia' },
        { codigo: 'M25.5', nombre: 'Dolor en articulación (artralgia)', categoria: 'Traumatología y Ortopedia' },
        { codigo: 'M79.1', nombre: 'Mialgia', categoria: 'Traumatología y Ortopedia' },
        { codigo: 'M75.1', nombre: 'Síndrome del manguito rotador', categoria: 'Traumatología y Ortopedia' },
        { codigo: 'S93.4', nombre: 'Esguince y torcedura del tobillo', categoria: 'Traumatología y Ortopedia' },
        { codigo: 'S83.6', nombre: 'Esguince y torcedura de otras partes de la rodilla', categoria: 'Traumatología y Ortopedia' },
        { codigo: 'S13.4', nombre: 'Esguince y torcedura de la columna cervical (latigazo cervical)', categoria: 'Traumatología y Ortopedia' },
        { codigo: 'S52.5', nombre: 'Fractura de la epífisis inferior del radio', categoria: 'Traumatología y Ortopedia' },
        { codigo: 'S42.0', nombre: 'Fractura de la clavícula', categoria: 'Traumatología y Ortopedia' },
        { codigo: 'S82.8', nombre: 'Fractura de otras partes de la pierna (tobillo)', categoria: 'Traumatología y Ortopedia' },
        { codigo: 'S72.0', nombre: 'Fractura del cuello del fémur (cadera)', categoria: 'Traumatología y Ortopedia' },
        { codigo: 'S06.0', nombre: 'Concussion / Traumatismo craneoencefálico (TCE) leve', categoria: 'Traumatología y Ortopedia' },
        { codigo: 'T14.1', nombre: 'Herida de región no especificada del cuerpo', categoria: 'Urgencias' },
        { codigo: 'T14.0', nombre: 'Traumatismo superficial / Contusión', categoria: 'Urgencias' },

        // Neurología, Psiquiatría y Síntomas Generales
        { codigo: 'R51', nombre: 'Cefalea', categoria: 'Neurología' },
        { codigo: 'G43.9', nombre: 'Migraña, no especificada', categoria: 'Neurología' },
        { codigo: 'G44.2', nombre: 'Cefalea debida a tensión (cefalea tensional)', categoria: 'Neurología' },
        { codigo: 'H81.1', nombre: 'Vértigo paroxístico benigno', categoria: 'Neurología' },
        { codigo: 'R42', nombre: 'Mareo y desvanecimiento (síndrome vertiginoso)', categoria: 'Neurología' },
        { codigo: 'F41.1', nombre: 'Trastorno de ansiedad generalizada', categoria: 'Psiquiatría' },
        { codigo: 'F41.0', nombre: 'Trastorno de pánico [ansiedad paroxística episódica]', categoria: 'Psiquiatría' },
        { codigo: 'F32.9', nombre: 'Episodio depresivo, no especificado', categoria: 'Psiquiatría' },
        { codigo: 'G47.0', nombre: 'Trastornos del inicio y del mantenimiento del sueño [insomnio]', categoria: 'Neurología' },
        { codigo: 'R10.4', nombre: 'Otros dolores abdominales y los no especificados', categoria: 'Síntomas Generales' },
        { codigo: 'R50.9', nombre: 'Fiebre, no especificada (síndrome febril)', categoria: 'Síntomas Generales' },
        { codigo: 'R11', nombre: 'Náusea y vómito', categoria: 'Síntomas Generales' },
        { codigo: 'T78.4', nombre: 'Alergia no especificada / Reacción alérgica aguda', categoria: 'Urgencias' },
        { codigo: 'L50.9', nombre: 'Urticaria, no especificada', categoria: 'Dermatología' },

        // Pediatría y Neonatología
        { codigo: 'Z00.1', nombre: 'Control de salud de rutina del niño (niño sano / recién nacido)', categoria: 'Pediatría' },
        { codigo: 'P59.9', nombre: 'Ictericia neonatal, no especificada', categoria: 'Pediatría' },
        { codigo: 'P22.0', nombre: 'Síndrome de dificultad respiratoria del recién nacido', categoria: 'Pediatría' },
        { codigo: 'J21.9', nombre: 'Bronquiolitis aguda, no especificada', categoria: 'Pediatría' }
    ];

    function buscarCIE10(consulta, limite) {
        const q = normalizar(consulta || '');
        const max = limite || 12;
        if (!q) return CATALOGO_CIE10.slice(0, max);
        const tokens = q.split(/\s+/).filter(Boolean);
        const puntuados = [];
        CATALOGO_CIE10.forEach(item => {
            const codNorm = normalizar(item.codigo);
            const nomNorm = normalizar(item.nombre);
            const catNorm = normalizar(item.categoria);
            const texto = codNorm + ' ' + nomNorm + ' ' + catNorm;
            if (!tokens.every(t => texto.indexOf(t) >= 0)) return;
            let score = 10;
            if (codNorm === q) score += 100;
            else if (codNorm.indexOf(q) === 0) score += 60;
            if (nomNorm.indexOf(q) === 0) score += 40;
            else if (nomNorm.indexOf(q) >= 0) score += 20;
            puntuados.push({ item, score });
        });
        puntuados.sort((a, b) => b.score - a.score || a.item.codigo.localeCompare(b.item.codigo));
        return puntuados.slice(0, max).map(x => x.item);
    }

    const CASO_REAL_MICHELLE = {
        paciente_id: 'PAC-000003',
        nombres: 'Michelle Alejandra',
        apellido_paterno: 'Guerrero',
        apellido_materno: 'Peña',
        nombre_completo: 'Michelle Alejandra Guerrero Peña',
        fecha_nacimiento: '2002-05-14',
        edad: 24,
        sexo: 'F',
        nacionalidad: 'Mexicana',
        lugar_nacimiento: 'Puerto Vallarta, Jalisco',
        religion: 'Católica',
        estado_civil: 'Soltera',
        ocupacion: 'Estudiante (Licenciatura en Psicología)',
        telefono: '3221984512',
        direccion: 'Col. Pitillal Centro, Puerto Vallarta, Jalisco',
        grupo_sanguineo: 'O+',
        signos_vitales: {
            ta_sistolica: 92, ta_diastolica: 75, frecuencia_cardiaca: 91,
            frecuencia_respiratoria: 19, temperatura_c: 36.2, spo2_porcentaje: 99,
            peso_kg: 52.5, talla_m: 1.62, glucemia: 85
        },
        ahf: 'Abuelos maternos con hipertensión arterial sistémica y diabetes mellitus tipo 2. Padres aparentemente sanos. Resto interrogado y negado.',
        apnp: 'Originaria y residente de Puerto Vallarta, Jalisco. Habita en casa propia de concreto que cuenta con todos los servicios básicos de urbanización (agua, luz, drenaje), sin hacinamiento, zoonosis positiva (1 perro vacunado y desparasitado). Alimentación regular en calidad y cantidad (3 comidas al día). Baño y cambio de ropa diario, cepillado dental 2 veces al día. Esquema de vacunación completo para la edad (incluye COVID-19 e Influenza). Tabaquismo, etilismo y toxicomanías interrogados y negados.',
        app: {
            alergias: null,
            otras: 'Infecciones de vías urinarias de repetición (último episodio hace 2 meses tratado con antibiótico no especificado). Niega crónico-degenerativos, quirúrgicos, traumáticos y transfusionales.'
        },
        ago: {
            menarca: 9,
            ritmo_menstrual: 'Regular (28 x 6 días, eumenorreica)',
            ivsa: 20,
            numero_parejas_sexuales: 2,
            metodo_planificacion: 'Ninguno previo al embarazo actual',
            fum: '2026-04-27',
            fpp: '2027-02-03',
            gestas: 1, partos: 0, cesareas: 0, abortos: 0,
            embarazo_actual: {
                presente: true,
                metodo_calculo_sdg: 'FUM',
                sdg: 25,
                sdg_texto: '25 semanas con 0 días (25.0 SDG por FUM · 24.4 SDG traspoladas por USG 2.º Trimestre)',
                trimestre: '2',
                usg_trimestre: '2',
                usg_fecha: '2026-08-30',
                usg_semanas: 18,
                usg_dias: 0,
                riesgo_obstetrico: 'Alto riesgo (IVU recurrente + Anemia gestacional + Vaginitis)',
                grupo_rh: 'O+',
                consultas_prenatales: 3,
                vacunas: ['Tdpa', 'Influenza'],
                micronutrientes: 'Ácido fólico y Hierro oral',
                afu_cm: 24,
                fcf_lpm: 147,
                leopold: 'Producto único vivo, longitudinal, pélvico, dorso a la derecha',
                movimientos_fetales: 'Presentes, normocinéticos',
                actividad_uterina: 'Ausente',
                cervix_membranas: 'Membranas íntegras, sin pérdidas transvaginales hemáticas ni hidrorrea',
                datos_alarma: 'Niega cefalea, acúfenos, fosfenos, epigastralgia o sangrado transvaginal',
                ultrasonidos: 'USG obstétrico del 30/08/2026 (2.º trimestre): Feto único vivo, fetometría promedio 18.0 SDG (24.4 SDG actuales traspoladas), FCF 147 lpm, placenta corporal anterior grado I, líquido amniótico normal.'
            }
        },
        motivo_consulta: 'Control prenatal + dolor abdominal tipo cólico en hipogastrio y disuria',
        padecimiento_actual: 'Paciente femenina de 24 años de edad, primigesta con embarazo de 25 SDG por FUM (24.4 SDG por USG de segundo trimestre del 30/08/2026). Acude a consulta refiriendo dolor abdominal en hipogastrio de 3 días de evolución, acompañado de disuria terminal, polaquiuria, tenesmo vesical y leucorrea blanquecina grumosa fétida acompañada de prurito vulvovaginal. Niega fiebre, sangrado transvaginal, salida de líquido amniótico, cefalea, acúfenos o fosfenos. Percibe movimientos fetales activos.',
        estudios_auxiliares: 'BH (19/10/2026): Hemoglobina 11.4 g/dL, Hematocrito 32.3%, Eritrocitos 3.74 M/uL, Leucocitos 9,400/uL, Plaquetas 245,000/uL.\nQS: Glucosa 70 mg/dL, Urea 15 mg/dL, Creatinina 0.6 mg/dL, Ácido úrico 3.4 mg/dL.\nEGO: Color amarillo turbio, pH 6.0, Densidad 1.020, Leucocitos 12-15 por campo, Esterasa leucocitaria positiva (+), Nitritos negativos, Bacterias moderadas, Células epiteliales abundantes.',
        exploracion_hallazgos: {
            abdomen: 'Abdomen globoso a expensas de útero gestante con fondo uterino a 24 cm por arriba de la sínfisis del pubis. Maniobras de Leopold: producto único vivo, longitudinal, presentación pélvica, dorso a la derecha. FCF 147 lpm rítmica. Dolor leve a la palpación profunda en hipogastrio y puntos ureterales medios positivos. Giordano dudoso bilateral. Sin actividad uterina.',
            rectal: 'Genitales externos de acuerdo a edad y sexo. Especuloscopia/inspección: paredes vaginales hiperémicas con leucorrea blanquecina adherente moderada, sin sangrado activo ni salida de líquido amniótico.'
        },
        diagnosticos: [
            { codigo: 'Z34.0', descripcion: 'Supervisión de primer embarazo normal (25 SDG por FUM / 24.4 SDG por USG 2.º Trimestre)' },
            { codigo: 'O23.4', descripcion: 'Infección de vías urinarias en el embarazo' },
            { codigo: 'N76.0', descripcion: 'Cervicovaginitis aguda en el embarazo' },
            { codigo: 'O99.0', descripcion: 'Anemia leve que complica el embarazo (Hb 11.4 g/dL)' }
        ],
        analisis_clinico: 'Paciente primigesta de 24 años cursando segundo trimestre de la gestación (25 SDG por FUM / 24.4 SDG por USG de 2.º trimestre), con adecuada vitalidad fetal (FCF 147 lpm, normocinético). Cursa con infección de vías urinarias bajas documentada por clínica y examen general de orina (piuria 12-15 leucocitos/campo), además de síndrome de descarga vaginal compatible con cervicovaginitis candidiásica/mixta y anemia gestacional leve normocítica (Hb 11.4 g/dL, Hto 32.3%). Requiere tratamiento antimicrobiano seguro en el embarazo para erradicar foco infeccioso urinario y vaginal (prevención de amenaza de parto pretérmino y ruptura prematura de membranas) y suplementación hematínica.',
        plan_tratamiento: '1. Cefalexina cápsulas 500 mg VO cada 8 horas por 7 días (o Nitrofurantoína 100 mg VO cada 12 horas por 7 días).\n2. Clotrimazol óvulos vaginales 100 mg: aplicar 1 óvulo vía vaginal cada 24 horas por las noches durante 7 días.\n3. Sulfato ferroso 200 mg + Ácido fólico 0.4 mg: tomar 1 tableta VO cada 24 horas en ayuno con jugo de cítricos.\n4. Paracetamol 500 mg VO cada 8 horas en caso de dolor abdominal o molestia urinaria.\n5. Abundantes líquidos orales (2.5 L/día), medidas higiénico-dietéticas urinarias y urocultivo de control 7 días post-tratamiento.\n6. Cita abierta a Urgencias ante datos de alarma obstétrica (sangrado transvaginal, salida de líquido, contracciones regulares, disminución de movimientos fetales, fiebre, cefalea intensa, acúfenos o fosfenos).'
    };

    const CATALOGO_FORMATOS_OFICIALES = [
        { id: 'DOC-01', nombre: 'Hoja Frontal Hospitalización', archivo: 'Hoja frontal hospitalización.pdf', categoria: 'Ingreso y Recepción', estado: 'Integrado en Hoja Frontal del Sistema (con Nacionalidad, Edad RN/Meses y Contacto de Emergencia)' },
        { id: 'DOC-02', nombre: 'Contrato de Prestación de Servicios Hospitalarios (PROFECO)', archivo: 'Contrato de prestacion de servicios 2025.docx', categoria: 'Jurídico / PROFECO', estado: 'Integrado con Registro PROFECO 6648-2023 y datos legales de Sanatorio Belén S.A. de C.V.' },
        { id: 'DOC-03', nombre: 'Historia Clínica General (NOM-004)', archivo: 'HISTORIA CLINICA.docx', categoria: 'Consulta y Hospitalización', estado: 'Integrado en Expediente Clínico Electrónico con Gineco-Obstetricia ampliada y CIE-10' },
        { id: 'DOC-04', nombre: 'Hoja de Evolución e Indicaciones Médicas', archivo: 'Hoja de Evolución e indicaciones medicas.docx', categoria: 'Hospitalización', estado: 'Integrado en Notas de Evolución y Hojas de Indicaciones con formato oficial y logo' },
        { id: 'DOC-05', nombre: 'Hoja de Indicaciones Médicas', archivo: 'Hoja de indicaciones medicas.docx', categoria: 'Hospitalización', estado: 'Integrado en Hojas de Indicaciones Médicas' },
        { id: 'DOC-06', nombre: 'Hoja Quirúrgica (Autorización + Nota Postoperatoria)', archivo: 'Hoja Quirurgica.docx', categoria: 'Quirófano', estado: 'Integrado en Modal y Formato Imprimible de Hoja Quirúrgica' },
        { id: 'DOC-07', nombre: 'Valoración Preanestésica y Nota Postanestésica', archivo: 'VALORACIÓN PREANESTÉSICA y post.docx', categoria: 'Anestesiología', estado: 'Integrado en Expediente de Quirófano (Aldrete, Bromage, ASA, Mallampati)' },
        { id: 'DOC-08', nombre: 'Registro Transanestésico', archivo: 'REGISTRO TRANSANESTESICO.pdf', categoria: 'Anestesiología', estado: 'Integrado en Registro Transanestésico y control de ámpulas Fracción I' },
        { id: 'DOC-09', nombre: 'Verificación de la Seguridad de la Cirugía (OMS)', archivo: 'Verificacion de la seguridad de la cirugía.pdf', categoria: 'Quirófano', estado: 'Integrado en Lista de Verificación OMS (Entrada, Pausa Quirúrgica, Salida)' },
        { id: 'DOC-10', nombre: 'Consentimientos Informados (Ingreso, Cirugía, Anestesia, Transfusión, OTB, Alta Voluntaria)', archivo: 'Consentimientos (18 formatos .docx/.pdf)', categoria: 'Consentimientos NOM-004', estado: 'Integrados en Generador de Consentimientos Informados con autofill del paciente y médico' },
        { id: 'DOC-11', nombre: 'Hoja de Enfermería (1 y 2) y Censo Diario', archivo: 'HOJA DE ENFERMERIA 1.pdf / 2.pdf / CENSO DIARIO.xlsx', categoria: 'Enfermería', estado: 'Integrado en Hoja de Enfermería Digital y Pizarra de Camas' },
        { id: 'DOC-12', nombre: 'Solicitud de Laboratorio y Paquetes Preoperatorios', archivo: 'SOLICITUD DE LABORATORIO (1).xlsx', categoria: 'Laboratorio', estado: 'Integrado en Solicitud de Estudios con consolidación inteligente de 1 tubo por color' },
        { id: 'DOC-13', nombre: 'Receta Médica Oficial y Hoja Membretada', archivo: 'HOJA MEMBRETADA.docx / logo ok poncho.pdf', categoria: 'Recetas y Papelería', estado: 'Integrado con Logo Oficial, Cédulas personalizadas, Alergias NEGADAS y sin lotes en receta' }
    ];

    function asegurarCasoRealMichelle() {
        const pacs = listarPacientes();
        const m = CASO_REAL_MICHELLE;
        let cambioPac = false;
        let pac = pacs.find(p => p.paciente_id === m.paciente_id || normalizar(p.nombre_completo) === normalizar(m.nombre_completo));
        if (!pac) {
            pac = {
                paciente_id: m.paciente_id,
                nombres: m.nombres,
                apellido_paterno: m.apellido_paterno,
                apellido_materno: m.apellido_materno,
                nombre_completo: m.nombre_completo,
                fecha_nacimiento: m.fecha_nacimiento,
                sexo: m.sexo,
                nacionalidad: m.nacionalidad,
                lugar_nacimiento: m.lugar_nacimiento,
                religion: m.religion,
                estado_civil: m.estado_civil,
                ocupacion: m.ocupacion,
                telefono: m.telefono,
                direccion: m.direccion,
                creado_en: '2026-10-19T16:00:00.000Z'
            };
            pacs.push(pac);
            cambioPac = true;
        } else if (!pac.nacionalidad) {
            pac.nacionalidad = 'Mexicana';
            cambioPac = true;
        }
        if (cambioPac) escribir(CLAVES.catalogo, pacs);

        const visitas = listarVisitas();
        if (!visitas.some(v => v.meta && v.meta.turno_id === 'T-DEMO-MICHELLE')) {
            const vDemo = expedienteDemo(pac, {
                turno_id: 'T-DEMO-MICHELLE',
                fecha: '2026-10-19T16:30:00.000Z',
                medico_id: USUARIOS.dra_sofia ? 'dra_sofia' : (USUARIOS.dr_arturo ? 'dr_arturo' : Object.keys(USUARIOS).find(k => USUARIOS[k].rol === 'medico')),
                destino: 'Alta',
                grupo: m.grupo_sanguineo,
                peso: m.signos_vitales.peso_kg,
                talla: m.signos_vitales.talla_m,
                motivo: m.motivo_consulta,
                padecimiento: m.padecimiento_actual,
                estudios: m.estudios_auxiliares,
                analisis: m.analisis_clinico,
                plan: m.plan_tratamiento,
                ahf: m.ahf,
                apnp: m.apnp,
                alergias: null,
                app: { cirugias: [], otras: m.app.otras },
                ago: m.ago,
                dx: m.diagnosticos.map(d => [d.codigo, d.descripcion]),
                medicamentos: 'Cefalexina 500 mg VO c/8h por 7 días · Clotrimazol óvulos 100 mg c/24h por 7 días · Sulfato ferroso + Ácido fólico c/24h'
            });
            vDemo.paciente.signos_vitales = Object.assign({}, m.signos_vitales, { imc: 20.0 });
            vDemo.paciente.nacionalidad = m.nacionalidad;
            vDemo.exploracion_fisica = vDemo.exploracion_fisica.map(s => {
                if (s.sistema_codigo === 'abdomen') return { sistema_codigo: 'abdomen', sistema: 'Abdomen', estatus: 'HALLAZGO', hallazgo: m.exploracion_hallazgos.abdomen, fcf_lpm: 147 };
                if (s.sistema_codigo === 'rectal') return { sistema_codigo: 'rectal', sistema: 'Tacto Rectal / GU', estatus: 'HALLAZGO', hallazgo: m.exploracion_hallazgos.rectal, fcf_lpm: null };
                return s;
            });
            visitas.push(vDemo);
            escribir(CLAVES.visitas, visitas);
        }
    }

    function sembrarDemoSiHaceFalta() {
        sembrarUsuariosSiHaceFalta();
        completarAnestesiologoCirugias();
        sembrarFarmaciaSiHaceFalta();
        if (localStorage.getItem("belen_seed_v19") === "1" && localStorage.getItem(CLAVES.catalogo) !== null) {
            asegurarCasosClinicosRecorrido(false);
            return false;
        }
        if (localStorage.getItem(CLAVES.catalogo) !== null || localStorage.getItem(CLAVES.visitas) !== null) {
            asegurarCasoRealMichelle();
            sembrarCirugiasSiHaceFalta();
            migrarCirugiasFase1();
            sembrarPacienteQuirofanoDemo();
            sembrarPacientesHospitalizadosDemo();
            asegurarCasosClinicosRecorrido(false);
            localStorage.setItem("belen_seed_v19", "1");
            return false;
        }
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
        asegurarCasoRealMichelle();
        escribir(CLAVES.demo, true);
        sembrarCirugiasSiHaceFalta();
        migrarCirugiasFase1();
        sembrarPacienteQuirofanoDemo();
        sembrarPacientesHospitalizadosDemo();
        localStorage.setItem("belen_seed_v19", "1");
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


    function sembrarPacientesHospitalizadosDemo() {
        const ahoraIso = new Date().toISOString();
        const turnos = listarTurnos();
        const ints = listarInternamientos();
        let cambioTurnos = false;
        let cambioInts = false;

        // 1. Carlos Ruiz Herrera en Habitación 1 (HOSP-1) con Dr. Arturo Gómez e interconsulta a Medicina Interna (Dr. Daniel Morales)
        if (!turnos.some(t => t.turno_id === "T-DEMO-HOSP-1") && !ints.some(i => i.internamiento_id === "INT-DEMO-HOSP-1")) {
            const medArturo = USUARIOS.dr_arturo || { id: "dr_arturo", medico_id: "dr_arturo", nombre: "Dr. Arturo Gómez", especialidad_codigo: "CIRUGIA_GENERAL" };
            const medInterna = USUARIOS.dr_internista || { id: "dr_internista", medico_id: "dr_internista", nombre: "Dr. Daniel Morales", especialidad_codigo: "MEDICINA_INTERNA" };
            const camaH1 = resolverCama("HOSP-1") || { codigo: "HOSP-1", nombre: "Habitación 1" };
            const snapCarlos = {
                destino: "Hospitalizacion",
                expediente_bloqueado: true,
                diagnósticosAgregados: ["Colelitiasis con colecistitis aguda (K80.0)"],
                campos: {
                    "input-fecha": ahoraIso.slice(0, 16),
                    "comp-civil": "Casado(a)",
                    "comp-tel": "3221110001",
                    "comp-ocupacion": "Contador",
                    "comp-dir": "Calle Morelos 120, Col. Centro",
                    "val-grupo": "A+",
                    "val-ta-sis": "132",
                    "val-ta-dia": "84",
                    "val-fc": "82",
                    "val-fr": "18",
                    "val-temp": "37.2",
                    "val-spo2": "97",
                    "val-peso": "84",
                    "val-talla": "1.74",
                    "val-motivo": "Dolor en hipocondrio derecho y náusea posprandial",
                    "val-padecimiento": "Paciente masculino de 47 años con cuadro de 48 horas de evolución caracterizado por dolor cólico en hipocondrio derecho irradiado a escápula ipsilateral, acompañado de náusea.",
                    "val-analisis": "Colecistitis aguda litiásica en preparación preoperatoria y control metabólico.",
                    "val-plan": "Hospitalización en piso, ayuno, hidratación parenteral, analgesia y valoración por Medicina Interna.",
                    "val-alarma": "Fiebre mayor a 38.5 °C, ictericia, dolor abdominal severo o dificultad respiratoria.",
                    "val-pronostico": "Bueno para la vida y la función tras resolución quirúrgica",
                    "val-ahf": "Padre con diabetes mellitus tipo 2 e hipertensión arterial.",
                    "val-apnp": "Originario y residente de Puerto Vallarta, habitación con todos los servicios, tabaquismo negado.",
                    "val-alergias": "Penicilina",
                    "hta-tiempo": "8 años",
                    "hta-meds": "Losartán 50 miligramos cada 24 horas",
                    "hta-apego": "Buen apego",
                    "dm2-tiempo": "5 años",
                    "dm2-meds": "Metformina 850 miligramos cada 12 horas",
                    "dm2-apego": "Buen apego",
                    "val-tipo-ingreso": "Ingreso a Hospitalización",
                    "val-area-destino": "HOSPITALIZACION",
                    "val-cama-ingreso": camaH1.codigo,
                    "ind-dieta": "Ayuno hasta nueva orden médica.",
                    "ind-soluciones": "Solución Hartmann 1000 mililitros vía intravenosa para 8 horas.",
                    "ind-medicamentos": "Ketorolaco 30 miligramos vía intravenosa cada 8 horas.\nOmeprazol 40 miligramos vía intravenosa cada 24 horas.",
                    "ind-medidas": "Control de signos vitales por turno y curva térmica. Vigilar datos de irritación peritoneal."
                },
                checks: {
                    "chk-alergias": true,
                    "chk-hta": true,
                    "chk-dm2": true,
                    "chk-mismo-pac": true
                }
            };
            turnos.push({
                turno_id: "T-DEMO-HOSP-1",
                paciente_id: "PAC-000001",
                paciente_nombre: "Carlos Ruiz Herrera",
                fecha_nacimiento: "1979-03-14",
                sexo: "M",
                especialidad_codigo: "CIRUGIA_GENERAL",
                especialidad: "Cirugía General",
                medico_id: medArturo.id,
                medico_nombre: medArturo.nombre,
                motivo: "Dolor en hipocondrio derecho · Ingreso a piso",
                fecha_turno: hoyLocal(),
                numero_turno: 2,
                timestamp_llegada: ahoraIso,
                timestamp_inicio_consulta: ahoraIso,
                timestamp_internamiento: ahoraIso,
                estatus: ESTATUS.INTERNADO,
                destino: "Hospitalizacion",
                area_destino: "Hospitalización",
                cama: camaH1.nombre,
                cama_codigo: camaH1.codigo,
                dx_principal: "Colelitiasis con colecistitis aguda (K80.0)",
                signos_vitales: { ta_sistolica: 132, ta_diastolica: 84, fc: 82, fr: 18, temp: 37.2, spo2: 97, peso: 84, talla: 1.74 },
                cargos: [],
                cuenta_actual: 0,
                cuenta_actual_total: 0,
                ordenes_aplicacion: []
            });
            cambioTurnos = true;
            const hojaCarlos = nuevaHojaIndicaciones([], "ingreso", {
                dieta: "Ayuno hasta nueva orden médica.",
                soluciones_parenterales: "Solución Hartmann 1000 mililitros vía intravenosa para 8 horas.",
                medicamentos: "Ketorolaco 30 miligramos vía intravenosa cada 8 horas.\nOmeprazol 40 miligramos vía intravenosa cada 24 horas.",
                medidas_generales: "Control de signos vitales por turno y curva térmica. Vigilar datos de irritación peritoneal."
            }, { id: medArturo.id, nombre: medArturo.nombre, relacion: "tratante" }, ahoraIso);
            anotarCoberturaIndicacion(hojaCarlos);
            ints.push({
                internamiento_id: "INT-DEMO-HOSP-1",
                turno_id: "T-DEMO-HOSP-1",
                paciente_id: "PAC-000001",
                medico_tratante_id: medArturo.id,
                medico_tratante_nombre: medArturo.nombre,
                especialidad_codigo: "CIRUGIA_GENERAL",
                especialidad: "Cirugía General",
                fecha_ingreso: ahoraIso,
                cama: camaH1.nombre,
                cama_codigo: camaH1.codigo,
                estatus: "activo",
                area_destino: "Hospitalización",
                area_codigo: "HOSPITALIZACION",
                destino: "Hospitalizacion",
                diagnostico_ingreso: "Colelitiasis con colecistitis aguda (K80.0)",
                diagnostico_actual: "Colelitiasis con colecistitis aguda (K80.0)",
                alergias: "Penicilina",
                snapshot_formulario: snapCarlos,
                interconsultas: [{
                    interconsulta_id: "IC-DEMO-1",
                    especialidad_codigo: "MEDICINA_INTERNA",
                    especialidad: "Medicina Interna",
                    medico_id: medInterna.id,
                    medico_nombre: medInterna.nombre,
                    motivo: "Valoración preoperatoria y control glucémico/hipertensivo",
                    fecha_hora: ahoraIso,
                    solicitada_por_id: medArturo.id,
                    solicitada_por_nombre: medArturo.nombre,
                    estatus: "PENDIENTE"
                }],
                notas_evolucion: [],
                hojas_indicaciones: [hojaCarlos],
                cargos: [],
                cuenta_actual: 0,
                cuenta_actual_total: 0,
                nota_egreso: null,
                ubicacion: UBICACION_QX.PISO,
                notas_postanestesicas: [],
                notas_postoperatorias: [],
                recetas_controlados: []
            });
            cambioInts = true;
        }

        // 2. Laura Méndez Olvera en Habitación 2 (HOSP-2) con Dr. Roberto Silva (Traumatología) e interconsulta a Dr. Juan Pérez (Medicina General)
        if (!turnos.some(t => t.turno_id === "T-DEMO-HOSP-2") && !ints.some(i => i.internamiento_id === "INT-DEMO-HOSP-2")) {
            const medRoberto = USUARIOS.dr_roberto || { id: "dr_roberto", medico_id: "dr_roberto", nombre: "Dr. Roberto Silva", especialidad_codigo: "TRAUMATOLOGIA" };
            const medJuan = USUARIOS.dr_juan || { id: "dr_juan", medico_id: "dr_juan", nombre: "Dr. Juan Pérez", especialidad_codigo: "MEDICINA_GENERAL" };
            const camaH2 = resolverCama("HOSP-2") || { codigo: "HOSP-2", nombre: "Habitación 2" };
            const snapLaura = {
                destino: "Hospitalizacion",
                expediente_bloqueado: true,
                diagnósticosAgregados: ["Esguince y torcedura de tobillo grado II-III en observación hospitalaria (S93.4)"],
                campos: {
                    "input-fecha": ahoraIso.slice(0, 16),
                    "comp-civil": "Unión Libre",
                    "comp-tel": "3221110002",
                    "comp-ocupacion": "Maestra",
                    "comp-dir": "Av. México 455, Col. Versalles",
                    "val-grupo": "O+",
                    "val-ta-sis": "118",
                    "val-ta-dia": "76",
                    "val-fc": "74",
                    "val-fr": "16",
                    "val-temp": "36.6",
                    "val-spo2": "98",
                    "val-peso": "61",
                    "val-talla": "1.62",
                    "val-motivo": "Dolor e inflamación severa en tobillo derecho tras caída",
                    "val-padecimiento": "Paciente femenina de 35 años que sufre inversión forzada de tobillo derecho con edema importante y limitación funcional para la marcha.",
                    "val-analisis": "Lesión ligamentaria aguda de tobillo derecho en manejo analgésico intravenoso e inmovilización.",
                    "val-plan": "Internamiento breve para control de dolor agudo, crioterapia, elevación de extremidad y férula posterior.",
                    "val-alarma": "Parestesias distales, palidez o cianosis de ortejos, dolor refractario.",
                    "val-pronostico": "Bueno para la vida y la función",
                    "val-ahf": "Madre con hipotiroidismo en control.",
                    "val-apnp": "Habitación urbana con todos los servicios, sin toxicomanías.",
                    "val-alergias": "Látex",
                    "val-tipo-ingreso": "Ingreso a Hospitalización",
                    "val-area-destino": "HOSPITALIZACION",
                    "val-cama-ingreso": camaH2.codigo,
                    "ind-dieta": "Dieta normal normosódica.",
                    "ind-soluciones": "Solución fisiológica 0.9% 500 mililitros vía intravenosa para mantener vena permeable.",
                    "ind-medicamentos": "Paracetamol 1 gramo vía intravenosa cada 8 horas.\nDiclofenaco 75 miligramos vía intramuscular cada 12 horas.",
                    "ind-medidas": "Reposo absoluto con extremidad pélvica derecha elevada. Vigilar llenado capilar distal por turno."
                },
                checks: {
                    "chk-alergias": true,
                    "chk-mismo-pac": true
                }
            };
            turnos.push({
                turno_id: "T-DEMO-HOSP-2",
                paciente_id: "PAC-000002",
                paciente_nombre: "Laura Méndez Olvera",
                fecha_nacimiento: "1991-07-22",
                sexo: "F",
                especialidad_codigo: "TRAUMATOLOGIA",
                especialidad: "Traumatología y Ortopedia",
                medico_id: medRoberto.id,
                medico_nombre: medRoberto.nombre,
                motivo: "Trauma de tobillo derecho · Control de dolor e inmovilización",
                fecha_turno: hoyLocal(),
                numero_turno: 1,
                timestamp_llegada: ahoraIso,
                timestamp_inicio_consulta: ahoraIso,
                timestamp_internamiento: ahoraIso,
                estatus: ESTATUS.INTERNADO,
                destino: "Hospitalizacion",
                area_destino: "Hospitalización",
                cama: camaH2.nombre,
                cama_codigo: camaH2.codigo,
                dx_principal: "Esguince y torcedura de tobillo grado II-III (S93.4)",
                signos_vitales: { ta_sistolica: 118, ta_diastolica: 76, fc: 74, fr: 16, temp: 36.6, spo2: 98, peso: 61, talla: 1.62 },
                cargos: [],
                cuenta_actual: 0,
                cuenta_actual_total: 0,
                ordenes_aplicacion: []
            });
            cambioTurnos = true;
            const hojaLaura = nuevaHojaIndicaciones([], "ingreso", {
                dieta: "Dieta normal normosódica.",
                soluciones_parenterales: "Solución fisiológica 0.9% 500 mililitros vía intravenosa para mantener vena permeable.",
                medicamentos: "Paracetamol 1 gramo vía intravenosa cada 8 horas.\nDiclofenaco 75 miligramos vía intramuscular cada 12 horas.",
                medidas_generales: "Reposo absoluto con extremidad pélvica derecha elevada. Vigilar llenado capilar distal por turno."
            }, { id: medRoberto.id, nombre: medRoberto.nombre, relacion: "tratante" }, ahoraIso);
            anotarCoberturaIndicacion(hojaLaura);
            ints.push({
                internamiento_id: "INT-DEMO-HOSP-2",
                turno_id: "T-DEMO-HOSP-2",
                paciente_id: "PAC-000002",
                medico_tratante_id: medRoberto.id,
                medico_tratante_nombre: medRoberto.nombre,
                especialidad_codigo: "TRAUMATOLOGIA",
                especialidad: "Traumatología y Ortopedia",
                fecha_ingreso: ahoraIso,
                cama: camaH2.nombre,
                cama_codigo: camaH2.codigo,
                estatus: "activo",
                area_destino: "Hospitalización",
                area_codigo: "HOSPITALIZACION",
                destino: "Hospitalizacion",
                diagnostico_ingreso: "Esguince y torcedura de tobillo grado II-III (S93.4)",
                diagnostico_actual: "Esguince y torcedura de tobillo grado II-III (S93.4)",
                alergias: "Látex",
                snapshot_formulario: snapLaura,
                interconsultas: [{
                    interconsulta_id: "IC-DEMO-2",
                    especialidad_codigo: "MEDICINA_GENERAL",
                    especialidad: "Medicina General",
                    medico_id: medJuan.id,
                    medico_nombre: medJuan.nombre,
                    motivo: "Seguimiento conjunto en piso",
                    fecha_hora: ahoraIso,
                    solicitada_por_id: medRoberto.id,
                    solicitada_por_nombre: medRoberto.nombre,
                    estatus: "PENDIENTE"
                }],
                notas_evolucion: [],
                hojas_indicaciones: [hojaLaura],
                cargos: [],
                cuenta_actual: 0,
                cuenta_actual_total: 0,
                nota_egreso: null,
                ubicacion: UBICACION_QX.PISO,
                notas_postanestesicas: [],
                notas_postoperatorias: [],
                recetas_controlados: []
            });
            cambioInts = true;
        }

        if (cambioTurnos) escribir(CLAVES.turnos, turnos);
        if (cambioInts) escribir(CLAVES.internamientos, ints);
        return cambioTurnos || cambioInts;
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
            edad: formatearEdad(fn, edad),
            sexo: sexo,
            servicio: (i && (i.area_destino || nombreAreaEstancia(i.area_codigo))) || t.area_destino || '',
            cama: cama || '',
            fecha_programacion: cir.fecha ? fechaLegibleISO(cir.fecha) : (cir.fecha_hora ? fechaHoraLegible(cir.fecha_hora) : ''),
            dx_pre: (i && (i.diagnostico_ingreso || i.diagnostico_actual)) || t.dx_principal || cir.procedimiento || '',
            preoperatorio: (i && (i.diagnostico_ingreso || i.diagnostico_actual)) || t.dx_principal || cir.procedimiento || '',
            operacion: cir.procedimiento || '',
            operacion_planeada: cir.procedimiento || '',
            fecha_hora_quirurgica: cir.fecha_hora ? fechaHoraLegible(cir.fecha_hora) : '',
            cirujano: cir.medico_cirujano_nombre || (i && i.medico_tratante_nombre) || t.medico_nombre || '',
            anestesiologo: cir.anestesiologo_nombre || '',
            ayudante: cir.ayudante_nombre || '',
            instrumentista: cir.instrumentista_nombre || '',
            circulante: cir.circulante_nombre || '',
            pediatra: cir.pediatra_nombre || '',
            tipo_anestesia: (i && i.nota_preanestesica && i.nota_preanestesica.tecnica_planeada) || (i && i.registro_transanestesico && i.registro_transanestesico.tecnica) || cir.tipo_anestesia || '',
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
            + '<div>' + lab('1er Ayudante (Pre-llenado por Administración)', 'po-ayudante') + '<input id="po-ayudante" class="' + cls + '" value="' + e(p.ayudante || '') + '"></div>'
            + '<div>' + lab('Anestesióloga/o', 'po-anestesiologo') + '<input id="po-anestesiologo" class="' + cls + '" value="' + e(p.anestesiologo || '') + '"></div>'
            + '<div>' + lab('Instrumentista (Pre-llenado por Administración)', 'po-instrumentista') + '<input id="po-instrumentista" class="' + cls + '" value="' + e(p.instrumentista || '') + '"></div>'
            + '<div>' + lab('Circulante (Pre-llenado por Administración)', 'po-circulante') + '<input id="po-circulante" class="' + cls + '" value="' + e(p.circulante || '') + '"></div>'
            + '<div>' + lab('Otra/o', 'po-otro') + '<input id="po-otro" class="' + cls + '" value="' + e(p.pediatra || '') + '"></div></div>'
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
            + linea('Ayudante', txt(firm.ayudante, f.ayudante))
            + linea('Anestesióloga/o', txt(firm.anestesiologo, f.anestesiologo))
            + linea('Instrumentista', txt(firm.instrumentista, f.instrumentista))
            + linea('Circulante', txt(firm.circulante, f.circulante))
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


    // ---------------------------------------------------------------- Expansor Automático de Abreviaturas Médicas
    function expandirAbreviaturasMedicas(texto) {
        if (!texto) return '';
        let t = String(texto);
        const reglas = [
            [/\b([0-9]+(?:\.[0-9]+)?)\s*grs?\b/gi, '$1 gramos'],
            [/\b([0-9]+(?:\.[0-9]+)?)\s*g\b/gi, '$1 gramos'],
            [/\b([0-9]+(?:\.[0-9]+)?)\s*mg\b/gi, '$1 miligramos'],
            [/\b([0-9]+(?:\.[0-9]+)?)\s*mcg\b/gi, '$1 microgramos'],
            [/\b([0-9]+(?:\.[0-9]+)?)\s*ui\b/gi, '$1 unidades internacionales'],
            [/\b([0-9]+(?:\.[0-9]+)?)\s*ml\b/gi, '$1 mililitros'],
            [/\bc\s*\/\s*([0-9]{1,2})\s*(?:hrs?|h)\b/gi, 'cada $1 horas'],
            [/\bcada\s+([0-9]{1,2})\s*hrs?\b/gi, 'cada $1 horas'],
            [/\bp\s*\/\s*([0-9]{1,2})\s*(?:hrs?|h)\b/gi, 'para $1 horas'],
            [/\bx\s+([0-9]{1,2})\s*d(?:ias|ías)?\b/gi, 'por $1 días'],
            [/\bv\.?\s*o\.?\b/gi, 'vía oral'],
            [/\bi\.?\s*v\.?\b/gi, 'vía intravenosa'],
            [/\bi\.?\s*m\.?\b/gi, 'vía intramuscular'],
            [/\bs\.?\s*c\.?\b/gi, 'vía subcutánea'],
            [/\bs\.?\s*l\.?\b/gi, 'vía sublingual'],
            [/\bp\.?\s*r\.?\s*n\.?\b/gi, 'por razón necesaria'],
            [/\bd\.?\s*u\.?\b/gi, 'dosis única'],
            [/\bdx\b/gi, 'diagnóstico'],
            [/\btx\b/gi, 'tratamiento'],
            [/\bpx\b/gi, 'paciente'],
            [/\b(?:has|hta)\b/gi, 'Hipertensión Arterial Sistémica'],
            [/\bdm2\b/gi, 'Diabetes Mellitus Tipo 2'],
            [/\bn\.?\s*p\.?\s*o\.?\b/gi, 'en ayuno hasta nueva orden'],
            [/\bahno\b/gi, 'en ayuno hasta nueva orden'],
            [/\bsvpt\b/gi, 'signos vitales por turno'],
            [/\bcge\b/gi, 'cuidados generales de enfermería'],
            [/\bsol\.?\s*fis(?:iol[oó]gica)?\b/gi, 'solución fisiológica 0.9%'],
            [/\bssn\s*0\.9%?\b/gi, 'solución salina normal 0.9%'],
            [/\bsol\.?\s*hartmann\b/gi, 'solución Hartmann'],
            [/\bsol\.?\s*gluc(?:osada)?\s*5%?\b/gi, 'solución glucosada al 5%'],
            [/\bamps?\b/gi, 'ámpula(s)'],
            [/\btabs?\b/gi, 'tableta(s)'],
            [/\bcaps?\b/gi, 'cápsula(s)']
        ];
        reglas.forEach(([rx, rep]) => { t = t.replace(rx, rep); });
        return t;
    }

    // ---------------------------------------------------------------- Confirmación de Cirugía por Administración (Alfonso)
    function confirmarCirugiaAdmin(cirugiaId, datosEquipo, s) {
        if (!s || (s.rol !== 'admin' && s.rol !== 'administrador')) return { ok: false, motivo: 'Solo Administración (Alfonso) o Dirección pueden confirmar la programación quirúrgica.' };
        const lista = listarCirugias();
        const c = lista.find(x => x.cirugia_id === cirugiaId);
        if (!c || c.estatus === 'cancelada') return { ok: false, motivo: 'No se encontró la cirugía.' };
        const eq = datosEquipo || {};
        if (eq.anestesiologo_id && USUARIOS[eq.anestesiologo_id]) {
            c.anestesiologo_id = eq.anestesiologo_id;
            c.anestesiologo_nombre = USUARIOS[eq.anestesiologo_id].nombre;
        } else if (eq.anestesiologo_nombre !== undefined) {
            c.anestesiologo_nombre = limpiarEspacios(eq.anestesiologo_nombre);
        }
        if (eq.ayudante_nombre !== undefined) c.ayudante_nombre = limpiarEspacios(eq.ayudante_nombre) || 'Por asignar / Personal externo';
        if (eq.instrumentista_nombre !== undefined) c.instrumentista_nombre = limpiarEspacios(eq.instrumentista_nombre) || 'Por asignar / Enfermería QX';
        if (eq.circulante_nombre !== undefined) c.circulante_nombre = limpiarEspacios(eq.circulante_nombre) || 'Por asignar / Enfermería QX';
        if (eq.pediatra_id && USUARIOS[eq.pediatra_id]) {
            c.pediatra_id = eq.pediatra_id;
            c.pediatra_nombre = USUARIOS[eq.pediatra_id].nombre;
        } else if (eq.pediatra_nombre !== undefined) {
            c.pediatra_nombre = limpiarEspacios(eq.pediatra_nombre);
        }
        c.confirmada_admin = true;
        c.estatus_confirmacion = 'CONFIRMADA';
        c.confirmada_por_id = s.usuario_id;
        c.confirmada_por_nombre = s.nombre;
        c.confirmada_en = new Date().toISOString();
        return escribir(CLAVES.cirugias, lista) ? { ok: true, cirugia: fichaCirugia(c) } : { ok: false, motivo: 'No se pudo guardar la confirmación.' };
    }

    // ---------------------------------------------------------------- Mover / Asignar Paciente en Plano Arquitectónico 2D
    function moverPacienteEnPlano(turnoId, codigoCamaDestino, s) {
        if (!s || (s.rol !== 'admin' && s.rol !== 'administrador' && !permisoAccionDe(s.usuario_id, 'asignar_cama'))) {
            return { ok: false, motivo: 'Su perfil no tiene permiso para ubicar o mover camas en el plano.' };
        }
        const i = asegurarInternamiento(turnoId);
        const t = obtenerTurno(turnoId);
        if (!i || !t || (t.estatus !== ESTATUS.INTERNADO && t.estatus !== ESTATUS.INTERNADO_EN_PROCESO)) {
            return { ok: false, motivo: 'Solo se puede ubicar en el plano a pacientes con ingreso u hospitalización activa.' };
        }
        const cama = resolverCama(codigoCamaDestino);
        if (!cama) return { ok: false, motivo: 'Seleccione una habitación o área clínica válida del plano.' };
        const ocupada = camaEstaOcupada(cama, i.internamiento_id);
        if (ocupada) {
            const o = obtenerTurno(ocupada.turno_id);
            return { ok: false, motivo: cama.nombre + ' ya está ocupada' + (o ? ' por ' + o.paciente_nombre : '') + '.' };
        }
        const areaNueva = cama.area;
        i.area_codigo = areaNueva;
        i.area_destino = nombreAreaEstancia(areaNueva);
        i.cama_codigo = cama.codigo;
        i.cama = cama.nombre;
        i.ubicacion = areaNueva === 'QUIROFANO' ? UBICACION_QX.QUIROFANO : UBICACION_QX.PISO;
        if (!guardarInternamiento(i)) return { ok: false, motivo: 'No se pudo actualizar la ubicación en el plano.' };
        actualizarTurno(t.turno_id, {
            area_destino: i.area_destino,
            destino: DESTINOS_AREA_ESTANCIA[areaNueva] || t.destino
        });
        return { ok: true, internamiento: obtenerInternamiento(i.internamiento_id), cama: cama };
    }

    // ---------------------------------------------------------------- Nota de Respuesta a Interconsulta (NOM-004-SSA3-2012)
    function responderInterconsulta(internamientoId, icId, entrada, s) {
        const i = obtenerInternamiento(internamientoId);
        if (!i || !s) return { ok: false, motivo: 'No se encontró el internamiento.' };
        const lista = i.interconsultas || [];
        const ic = lista.find(x => x.interconsulta_id === icId) || lista.find(x => x.medico_id === s.medico_id && !x.respondida_en) || lista[lista.length - 1];
        if (!ic) return { ok: false, motivo: 'No se encontró la solicitud de interconsulta.' };
        if (s.rol !== 'admin' && (s.rol !== 'medico' || (ic.medico_id !== s.medico_id && i.medico_tratante_id !== s.medico_id))) {
            return { ok: false, motivo: 'Solo el médico interconsultado o Dirección pueden emitir la Nota de Interconsulta.' };
        }
        const hallazgos = limpiarEspacios(entrada.hallazgos_exploracion || entrada.hallazgos || '');
        const criterio = limpiarEspacios(entrada.criterio_diagnostico || entrada.diagnostico_interconsulta || entrada.diagnostico || '');
        const plan = limpiarEspacios(entrada.sugerencias_terapeuticas || entrada.plan_sugerencias || entrada.plan_recomendaciones || entrada.plan || '');
        const errores = {};
        if (hallazgos.length < 5) errores.hallazgos_exploracion = 'Describa los hallazgos clínicos relevantes (mínimo 5 caracteres).';
        if (criterio.length < 5) errores.criterio_diagnostico = 'Escriba el criterio diagnóstico o impresión diagnóstica.';
        if (plan.length < 5) errores.sugerencias_terapeuticas = 'Escriba el plan y sugerencias diagnósticas/terapéuticas.';
        if (Object.keys(errores).length) return { ok: false, motivo: 'Complete los campos obligatorios de la Nota de Interconsulta.', errores: errores };
        const u = USUARIOS[s.usuario_id] || USUARIOS[ic.medico_id] || {};
        ic.respondida_en = new Date().toISOString();
        ic.respondida_por_id = s.usuario_id;
        ic.respondida_por_nombre = u.nombre || s.nombre;
        ic.cedulas_impresas = textoCedulasFirma(u) || '';
        ic.motivo_interconsulta = limpiarEspacios(entrada.motivo_interconsulta || ic.motivo_interconsulta || 'Valoración especializada solicitada por médico tratante');
        ic.hallazgos_exploracion = hallazgos;
        ic.criterio_diagnostico = criterio;
        ic.sugerencias_terapeuticas = expandirAbreviaturasMedicas(plan);
        ic.pronostico = limpiarEspacios(entrada.pronostico || 'Reservado a evolución');
        ic.estatus = 'RESPONDIDA';
        ic.fecha_respuesta = ic.respondida_en;
        ic.nota_respuesta = ic.sugerencias_terapeuticas;
        ic.folio_respuesta = ic.folio_respuesta || ('NIC-' + String((i.interconsultas || []).length).padStart(2, '0'));
        return guardarInternamiento(i) ? { ok: true, interconsulta: ic, internamiento: obtenerInternamiento(i.internamiento_id) } : { ok: false, motivo: 'No se pudo guardar la Nota de Interconsulta.' };
    }

    function htmlImpresionNotaInterconsulta(ic, turnoId) {
        const e = escHtmlCuenta;
        const t = obtenerTurno(turnoId);
        const i = internamientoDeTurno(turnoId);
        const p = (t && buscarPacientePorId(t.paciente_id)) || {};
        const nombrePac = p.nombre_completo || (t && t.paciente_nombre) || 'Paciente';
        const edadTxt = formatearEdad(p.fecha_nacimiento || (t && t.fecha_nacimiento), calcularEdad(p.fecha_nacimiento || (t && t.fecha_nacimiento)));
        const sexoTxt = (p.sexo || (t && t.sexo)) === 'F' ? 'Femenino' : 'Masculino';
        const u = (ic && ic.respondida_por_id && USUARIOS[ic.respondida_por_id]) || (ic && ic.medico_id && USUARIOS[ic.medico_id]) || {};
        const cedulas = e(textoCedulasFirma(u) || (ic && ic.cedulas_impresas) || '').replace(/\n/g, '<br>');
        const espTxt = especialidadImpresaMedico(u) || (ic && ic.especialidad) || '';
        return '<article style="font-family:Arial,sans-serif;color:#0f172a;max-width:19.5cm;margin:0 auto;font-size:11.5px;line-height:1.4;page-break-inside:avoid;">'
            + '<header style="display:flex;justify-content:center;align-items:center;border-bottom:2px solid #0b3a5b;padding-bottom:8px;margin-bottom:10px;">'
            + '<div style="text-align:right;"><div style="font-size:13px;font-weight:900;color:#0b3a5b;text-transform:uppercase;">NOTA DE INTERCONSULTA</div><div style="font-size:10px;color:#475569;">NOM-004-SSA3-2012 (Num. 6.3) · Folio: <strong>' + e((ic && ic.folio_respuesta) || 'NIC-01') + '</strong></div></div></header>'
            + '<div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;padding:8px 10px;margin-bottom:10px;display:grid;grid-template-columns:2fr 1fr 1fr;gap:6px;font-size:11px;">'
            + '<div><strong>Paciente:</strong> ' + e(nombrePac) + '</div><div><strong>Edad / Sexo:</strong> ' + e(edadTxt) + ' · ' + e(sexoTxt) + '</div><div><strong>Expediente:</strong> ' + e((t && t.paciente_id) || 'S/N') + '</div>'
            + '<div><strong>Especialidad Interconsultada:</strong> ' + e((ic && ic.especialidad) || espTxt) + '</div><div><strong>Cama:</strong> ' + e((i && i.cama) || 'Piso') + '</div><div><strong>Fecha y Hora:</strong> ' + e(fechaHoraLegible((ic && ic.respondida_en) || new Date().toISOString())) + '</div>'
            + '<div style="grid-column:span 3;"><strong>Solicitada por (Médico Tratante):</strong> ' + e((ic && ic.solicitada_por_nombre) || (i && i.medico_tratante_nombre) || '') + ' · <strong>Diagnóstico de Ingreso:</strong> ' + e((i && i.diagnostico_actual) || (t && t.motivo) || '') + '</div></div>'
            + '<div style="margin-bottom:8px;"><div style="font-weight:bold;font-size:10.5px;text-transform:uppercase;color:#0b3a5b;border-bottom:1px solid #cbd5e1;margin-bottom:3px;">1. Motivo de la Interconsulta</div><div style="white-space:pre-wrap;">' + e((ic && ic.motivo_interconsulta) || 'Valoración por especialidad.') + '</div></div>'
            + '<div style="margin-bottom:8px;"><div style="font-weight:bold;font-size:10.5px;text-transform:uppercase;color:#0b3a5b;border-bottom:1px solid #cbd5e1;margin-bottom:3px;">2. Resumen de Interrogatorio, Exploración Física y Resultados Relevantes</div><div style="white-space:pre-wrap;">' + e((ic && ic.hallazgos_exploracion) || '') + '</div></div>'
            + '<div style="margin-bottom:8px;"><div style="font-weight:bold;font-size:10.5px;text-transform:uppercase;color:#0b3a5b;border-bottom:1px solid #cbd5e1;margin-bottom:3px;">3. Criterio Diagnóstico / Impresión Diagnóstica</div><div style="white-space:pre-wrap;font-weight:bold;">' + e((ic && ic.criterio_diagnostico) || '') + '</div></div>'
            + '<div style="margin-bottom:8px;"><div style="font-weight:bold;font-size:10.5px;text-transform:uppercase;color:#0b3a5b;border-bottom:1px solid #cbd5e1;margin-bottom:3px;">4. Plan de Estudios y Sugerencias Diagnósticas y Terapéuticas</div><div style="white-space:pre-wrap;">' + e((ic && ic.sugerencias_terapeuticas) || '') + '</div></div>'
            + '<div style="margin-bottom:14px;"><div style="font-weight:bold;font-size:10.5px;text-transform:uppercase;color:#0b3a5b;border-bottom:1px solid #cbd5e1;margin-bottom:3px;">5. Pronóstico</div><div>' + e((ic && ic.pronostico) || 'Reservado a evolución.') + '</div></div>'
            + '<footer style="margin-top:24px;text-align:center;page-break-inside:avoid;"><div style="display:inline-block;min-width:260px;border-top:1px solid #0f172a;padding-top:4px;font-size:11px;"><strong>' + e((ic && ic.respondida_por_nombre) || u.nombre || '') + '</strong><br><span style="font-size:10px;">' + e(espTxt) + '</span><br>' + cedulas + '<br><span style="font-size:9.5px;color:#475569;">Médico Interconsultante</span></div></footer></article>';
    }

    // ---------------------------------------------------------------- Valoración Preoperatoria / Riesgo Quirúrgico (Medicina Interna / Cardiología)
    function guardarValoracionPreoperatoria(turnoId, entrada, s) {
        const i = asegurarInternamiento(turnoId);
        if (!i || !s || (s.rol !== 'medico' && s.rol !== 'admin')) return { ok: false, motivo: 'Solo el médico o Dirección pueden registrar la Valoración Preoperatoria.' };
        const cirugia = limpiarEspacios(entrada.cirugia_planeada || entrada.cirugia_proyectada || entrada.cirugia_programada || '');
        const ekg = limpiarEspacios(entrada.hallazgos_ekg_rx || entrada.laboratorios_previos || entrada.diagnostico_preoperatorio || 'EKG y laboratorios preoperatorios revisados');
        const recomendaciones = limpiarEspacios(entrada.recomendaciones_perioperatorias || entrada.recomendaciones || entrada.plan_preoperatorio || '');
        const errores = {};
        if (cirugia.length < 3) errores.cirugia_planeada = 'Indique el procedimiento quirúrgico planeado.';
        if (ekg.length < 4) errores.hallazgos_ekg_rx = 'Describa los hallazgos de EKG, tele de tórax y laboratorios.';
        if (recomendaciones.length < 5) errores.recomendaciones_perioperatorias = 'Indique las recomendaciones perioperatorias y tromboprofilaxis.';
        if (Object.keys(errores).length) return { ok: false, motivo: 'Complete los campos de la Valoración Preoperatoria.', errores: errores };
        const u = USUARIOS[s.usuario_id] || {};
        const val = {
            valoracion_id: uid('VPRE'),
            folio: 'VPRE-' + String(((i.valoraciones_preoperatorias || []).length) + 1).padStart(2, '0'),
            fecha_hora: new Date().toISOString(),
            medico_id: s.medico_id || s.usuario_id,
            medico_nombre: u.nombre || s.nombre,
            medico_especialidad: especialidadImpresaMedico(u),
            cedulas_impresas: textoCedulasFirma(u) || '',
            diagnostico_preoperatorio: limpiarEspacios(entrada.diagnostico_preoperatorio || i.diagnostico_actual || ''),
            cirugia_planeada: cirugia,
            cirugia_proyectada: cirugia,
            tipo_cirugia: limpiarEspacios(entrada.tipo_cirugia || 'Electiva'),
            clase_asa: limpiarEspacios(entrada.clase_asa || entrada.asa || 'ASA II'),
            asa: limpiarEspacios(entrada.clase_asa || entrada.asa || 'ASA II'),
            goldman_clase: limpiarEspacios(entrada.goldman_clase || entrada.goldman || 'Clase I (<1% riesgo de complicación cardiovascular mayor)'),
            goldman: limpiarEspacios(entrada.goldman_clase || entrada.goldman || 'Clase I (<1% riesgo de complicación cardiovascular mayor)'),
            lee_rcri: limpiarEspacios(entrada.lee_rcri || '0 puntos (Riesgo muy bajo 0.4%)'),
            caprini_trombo: limpiarEspacios(entrada.caprini_trombo || entrada.riesgo_tromboembolico || 'Riesgo moderado (2-4 pts) · Medias compresivas + movilización temprana'),
            riesgo_tromboembolico: limpiarEspacios(entrada.caprini_trombo || entrada.riesgo_tromboembolico || 'Riesgo moderado (2-4 pts) · Medias compresivas + movilización temprana'),
            horas_ayuno: limpiarEspacios(entrada.horas_ayuno || 'Ayuno >= 8 horas cumplido'),
            nyha_funcional: limpiarEspacios(entrada.nyha_funcional || 'NYHA I (>4 METs)'),
            hallazgos_ekg_rx: ekg,
            laboratorios_previos: ekg,
            laboratorios_preop: limpiarEspacios(entrada.laboratorios_preop || ekg || ''),
            recomendaciones_perioperatorias: expandirAbreviaturasMedicas(recomendaciones),
            recomendaciones: expandirAbreviaturasMedicas(recomendaciones),
            conclusion_aptitud: limpiarEspacios(entrada.conclusion_aptitud || 'APTO PARA PROCEDIMIENTO QUIRÚRGICO CON RIESGO DESCRITO')
        };
        i.valoraciones_preoperatorias = (i.valoraciones_preoperatorias || []).concat([val]);
        i.valoracion_preoperatoria = val;
        return guardarInternamiento(i) ? { ok: true, valoracion: val, internamiento: obtenerInternamiento(i.internamiento_id) } : { ok: false, motivo: 'No se pudo guardar la Valoración Preoperatoria.' };
    }

    function htmlImpresionValoracionPreoperatoria(val, turnoId) {
        const e = escHtmlCuenta;
        const t = obtenerTurno(turnoId);
        const p = (t && buscarPacientePorId(t.paciente_id)) || {};
        const nombrePac = p.nombre_completo || (t && t.paciente_nombre) || 'Paciente';
        const edadTxt = formatearEdad(p.fecha_nacimiento || (t && t.fecha_nacimiento), calcularEdad(p.fecha_nacimiento || (t && t.fecha_nacimiento)));
        const sexoTxt = (p.sexo || (t && t.sexo)) === 'F' ? 'Femenino' : 'Masculino';
        const cedulas = e((val && val.cedulas_impresas) || '').replace(/\n/g, '<br>');
        return '<article style="font-family:Arial,sans-serif;color:#0f172a;max-width:19.5cm;margin:0 auto;font-size:11px;line-height:1.38;page-break-inside:avoid;">'
            + '<header style="display:flex;justify-content:center;align-items:center;border-bottom:2px solid #0b3a5b;padding-bottom:8px;margin-bottom:10px;">'
            + '<div style="text-align:right;"><div style="font-size:13px;font-weight:900;color:#0b3a5b;text-transform:uppercase;">NOTA DE VALORACIÓN PREOPERATORIA</div><div style="font-size:10px;color:#475569;">NOM-004-SSA3-2012 (Num. 8.5) · Folio: <strong>' + e((val && val.folio) || 'VPRE-01') + '</strong></div></div></header>'
            + '<div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;padding:8px 10px;margin-bottom:10px;display:grid;grid-template-columns:2fr 1fr 1fr;gap:6px;">'
            + '<div><strong>Paciente:</strong> ' + e(nombrePac) + '</div><div><strong>Edad / Sexo:</strong> ' + e(edadTxt) + ' · ' + e(sexoTxt) + '</div><div><strong>Expediente:</strong> ' + e((t && t.paciente_id) || 'S/N') + '</div>'
            + '<div style="grid-column:span 2;"><strong>Cirugía Planeada:</strong> ' + e((val && val.cirugia_planeada) || '') + ' (' + e((val && val.tipo_cirugia) || 'Electiva') + ')</div><div><strong>Fecha:</strong> ' + e(fechaHoraLegible(val && val.fecha_hora)) + '</div></div>'
            + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">'
            + '<div style="border:1px solid #cbd5e1;border-radius:6px;padding:6px 8px;"><strong>Estado Físico ASA:</strong> ' + e(val && val.clase_asa) + '</div>'
            + '<div style="border:1px solid #cbd5e1;border-radius:6px;padding:6px 8px;"><strong>Capacidad Funcional (NYHA / METs):</strong> ' + e(val && val.nyha_funcional) + '</div>'
            + '<div style="border:1px solid #cbd5e1;border-radius:6px;padding:6px 8px;"><strong>Índice de Riesgo Cardíaco de Goldman:</strong> ' + e(val && val.goldman_clase) + '</div>'
            + '<div style="border:1px solid #cbd5e1;border-radius:6px;padding:6px 8px;"><strong>Índice de Lee Revisado (RCRI):</strong> ' + e(val && val.lee_rcri) + '</div>'
            + '<div style="border:1px solid #cbd5e1;border-radius:6px;padding:6px 8px;grid-column:span 2;"><strong>Riesgo Tromboembólico (Escala de Caprini):</strong> ' + e(val && val.caprini_trombo) + '</div></div>'
            + '<div style="margin-bottom:8px;"><div style="font-weight:bold;font-size:10.5px;text-transform:uppercase;color:#0b3a5b;border-bottom:1px solid #cbd5e1;margin-bottom:3px;">Electrocardiograma (EKG 12 derivaciones) y Tele de Tórax</div><div style="white-space:pre-wrap;">' + e((val && val.hallazgos_ekg_rx) || '') + '</div></div>'
            + '<div style="margin-bottom:8px;"><div style="font-weight:bold;font-size:10.5px;text-transform:uppercase;color:#0b3a5b;border-bottom:1px solid #cbd5e1;margin-bottom:3px;">Laboratorios Preoperatorios (BH, QS, ES, TP/TPT, Grupo y Rh)</div><div style="white-space:pre-wrap;">' + e((val && val.laboratorios_preop) || 'Dentro de parámetros aceptables para procedimiento.') + '</div></div>'
            + '<div style="margin-bottom:8px;"><div style="font-weight:bold;font-size:10.5px;text-transform:uppercase;color:#0b3a5b;border-bottom:1px solid #cbd5e1;margin-bottom:3px;">Plan y Recomendaciones Perioperatorias (Ayuno, Medicación Crónica, Profilaxis)</div><div style="white-space:pre-wrap;">' + e((val && val.recomendaciones_perioperatorias) || '') + '</div></div>'
            + '<div style="background:#ecfdf5;border:1.5px solid #059669;border-radius:6px;padding:7px 10px;margin-bottom:16px;font-weight:bold;color:#065f46;text-align:center;">DICTAMEN PREOPERATORIO: ' + e((val && val.conclusion_aptitud) || 'APTO PARA PROCEDIMIENTO QUIRÚRGICO') + '</div>'
            + '<footer style="margin-top:22px;text-align:center;page-break-inside:avoid;"><div style="display:inline-block;min-width:260px;border-top:1px solid #0f172a;padding-top:4px;font-size:11px;"><strong>' + e((val && val.medico_nombre) || '') + '</strong><br><span style="font-size:10px;">' + e((val && val.medico_especialidad) || 'Medicina Interna') + '</span><br>' + cedulas + '</div></footer></article>';
    }

    // ---------------------------------------------------------------- Hoja de Atención del Recién Nacido (Pediatría / Neonatología — Sin Tamiz)
    function guardarHojaRecienNacido(turnoId, entrada, s) {
        const i = asegurarInternamiento(turnoId);
        if (!i || !s || (s.rol !== 'medico' && s.rol !== 'admin' && !esEnfermeria(s.rol))) return { ok: false, motivo: 'Sin permiso para registrar la Hoja de Recién Nacido.' };
        const pesoG = parseInt(String(entrada.peso_gramos || entrada.peso_g || '3200').replace(/[^0-9]/g, ''), 10);
        const tallaCm = parseFloat(String(entrada.talla_cm || '50').replace(/[^0-9.]/g, ''));
        const apgarSplit = String(entrada.apgar || '').split('/');
        const ap1 = limpiarEspacios(entrada.apgar_1 || apgarSplit[0] || '8');
        const ap5 = limpiarEspacios(entrada.apgar_5 || apgarSplit[1] || '9');
        const errores = {};
        if (!Number.isFinite(pesoG) || pesoG < 300 || pesoG > 6500) errores.peso_gramos = 'Indique el peso al nacer en gramos (300 a 6,500 g).';
        if (!Number.isFinite(tallaCm) || tallaCm < 20 || tallaCm > 65) errores.talla_cm = 'Indique la talla en cm (20 a 65 cm).';
        if (!ap1 || !ap5) errores.apgar_1 = 'Indique la calificación de Apgar al minuto 1 y al minuto 5.';
        if (Object.keys(errores).length) return { ok: false, motivo: 'Revise los datos antropométricos y Apgar del recién nacido.', errores: errores };
        const u = USUARIOS[s.usuario_id] || {};
        const rn = {
            rn_id: uid('RN'),
            folio: 'RN-' + String(((i.hojas_recien_nacido || []).length) + 1).padStart(2, '0'),
            fecha_hora_nacimiento: entrada.fecha_hora_nacimiento || new Date().toISOString(),
            registrado_en: new Date().toISOString(),
            medico_id: s.medico_id || s.usuario_id,
            medico_nombre: u.nombre || s.nombre,
            medico_especialidad: especialidadImpresaMedico(u) || 'Pediatría / Neonatología',
            cedulas_impresas: textoCedulasFirma(u) || '',
            sexo_rn: entrada.sexo_rn || 'Femenino',
            via_nacimiento: entrada.via_nacimiento || 'Cesárea',
            peso_gramos: pesoG,
            talla_cm: tallaCm,
            pc_cm: entrada.pc_cm || '34',
            pt_cm: entrada.pt_cm || '33',
            pa_cm: entrada.pa_cm || '31',
            pie_cm: entrada.pie_cm || '7.5',
            peso_g: pesoG + ' g',
            apgar_1: ap1,
            apgar_5: ap5,
            apgar: ap1 + ' / ' + ap5,
            fecha_hora: entrada.fecha_hora_nacimiento || new Date().toISOString(),
            pediatra_nombre: u.nombre || s.nombre,
            silverman: entrada.silverman || '0 (Sin dificultad respiratoria)',
            capurro_sdg: entrada.capurro_sdg || '39 SDG (Recién nacido de término / Peso adecuado EGE)',
            reanimacion: limpiarEspacios(entrada.reanimacion || 'Pasos iniciales de reanimación neonatal (calor radiante, secado, aspiración de secreciones, estimulación táctil). Llanto vigoroso inmediato.'),
            profilaxis_oftalmica: entrada.profilaxis_oftalmica !== false,
            vitamina_k: entrada.vitamina_k !== false,
            permeabilidad_coanas_esofago_ano: entrada.permeabilidad_coanas_esofago_ano !== false,
            exploracion_neonatal: limpiarEspacios(entrada.exploracion_neonatal || 'Fontanelas normotensas, paladar íntegro, clavículas íntegras, campos pulmonares bien ventilados, precordio rítmico sin soplos, muñón umbilical con 2 arterias y 1 vena, caderas estables (Ortolani/Barlow negativos), tono y reflejos primitivos (Moro, succión, búsqueda) presentes.'),
            destino_rn: limpiarEspacios(entrada.destino_rn || 'Alojamiento conjunto / Cunero fisiológico con lactancia materna exclusiva a libre demanda.')
        };
        i.hojas_recien_nacido = (i.hojas_recien_nacido || []).concat([rn]);
        i.hoja_recien_nacido = rn;
        return guardarInternamiento(i) ? { ok: true, recien_nacido: rn, internamiento: obtenerInternamiento(i.internamiento_id) } : { ok: false, motivo: 'No se pudo guardar la Hoja del Recién Nacido.' };
    }

    function htmlImpresionHojaRecienNacido(rn, turnoId) {
        const e = escHtmlCuenta;
        const t = obtenerTurno(turnoId);
        const p = (t && buscarPacientePorId(t.paciente_id)) || {};
        const madre = p.nombre_completo || (t && t.paciente_nombre) || 'Madre';
        const cedulas = e((rn && rn.cedulas_impresas) || '').replace(/\n/g, '<br>');
        return '<article style="font-family:Arial,sans-serif;color:#0f172a;max-width:19.5cm;margin:0 auto;font-size:11px;line-height:1.38;page-break-inside:avoid;">'
            + '<header style="display:flex;justify-content:center;align-items:center;border-bottom:2px solid #0b3a5b;padding-bottom:8px;margin-bottom:10px;">'
            + '<div style="text-align:right;"><div style="font-size:13px;font-weight:900;color:#0b3a5b;text-transform:uppercase;">HISTORIA CLÍNICA Y ATENCIÓN DEL RECIÉN NACIDO</div><div style="font-size:10px;color:#475569;">NOM-007-SSA2-2016 / NOM-004 · Folio: <strong>' + e((rn && rn.folio) || 'RN-01') + '</strong></div></div></header>'
            + '<div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;padding:8px 10px;margin-bottom:10px;display:grid;grid-template-columns:2fr 1fr 1fr;gap:6px;">'
            + '<div><strong>Recién Nacido de:</strong> ' + e(madre) + '</div><div><strong>Sexo del RN:</strong> ' + e(rn && rn.sexo_rn) + '</div><div><strong>Vía de Nacimiento:</strong> ' + e(rn && rn.via_nacimiento) + '</div>'
            + '<div style="grid-column:span 2;"><strong>Fecha y Hora de Nacimiento:</strong> ' + e(fechaHoraLegible(rn && rn.fecha_hora_nacimiento)) + '</div><div><strong>Exp. Materno:</strong> ' + e((t && t.paciente_id) || 'S/N') + '</div></div>'
            + '<div style="font-weight:bold;font-size:10.5px;text-transform:uppercase;color:#0b3a5b;border-bottom:1px solid #cbd5e1;margin-bottom:6px;">1. Somatometría y Valoración Neonatal Inmediata</div>'
            + '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-bottom:8px;text-align:center;">'
            + '<div style="border:1px solid #cbd5e1;border-radius:5px;padding:5px;"><div style="font-size:9px;color:#64748b;">PESO</div><strong>' + e(rn && rn.peso_gramos) + ' g</strong></div>'
            + '<div style="border:1px solid #cbd5e1;border-radius:5px;padding:5px;"><div style="font-size:9px;color:#64748b;">TALLA</div><strong>' + e(rn && rn.talla_cm) + ' cm</strong></div>'
            + '<div style="border:1px solid #cbd5e1;border-radius:5px;padding:5px;"><div style="font-size:9px;color:#64748b;">P. CEFÁLICO</div><strong>' + e(rn && rn.pc_cm) + ' cm</strong></div>'
            + '<div style="border:1px solid #cbd5e1;border-radius:5px;padding:5px;"><div style="font-size:9px;color:#64748b;">P. TORÁCICO</div><strong>' + e(rn && rn.pt_cm) + ' cm</strong></div>'
            + '<div style="border:1px solid #cbd5e1;border-radius:5px;padding:5px;"><div style="font-size:9px;color:#64748b;">P. ABDOMINAL</div><strong>' + e(rn && rn.pa_cm) + ' cm</strong></div>'
            + '<div style="border:1px solid #cbd5e1;border-radius:5px;padding:5px;"><div style="font-size:9px;color:#64748b;">PIE</div><strong>' + e(rn && rn.pie_cm) + ' cm</strong></div></div>'
            + '<div style="display:grid;grid-template-columns:1fr 1fr 1.5fr;gap:6px;margin-bottom:10px;">'
            + '<div style="border:1px solid #cbd5e1;border-radius:5px;padding:6px;"><strong>Apgar (1 min / 5 min):</strong> ' + e(rn && rn.apgar_1) + ' / ' + e(rn && rn.apgar_5) + '</div>'
            + '<div style="border:1px solid #cbd5e1;border-radius:5px;padding:6px;"><strong>Silverman-Anderson:</strong> ' + e(rn && rn.silverman) + '</div>'
            + '<div style="border:1px solid #cbd5e1;border-radius:5px;padding:6px;"><strong>Edad Gestacional (Capurro):</strong> ' + e(rn && rn.capurro_sdg) + '</div></div>'
            + '<div style="margin-bottom:8px;"><div style="font-weight:bold;font-size:10.5px;text-transform:uppercase;color:#0b3a5b;border-bottom:1px solid #cbd5e1;margin-bottom:3px;">2. Reanimación Neonatal y Profilaxis de Ley</div>'
            + '<div style="margin-bottom:4px;">' + e(rn && rn.reanimacion) + '</div>'
            + '<div style="font-size:10.5px;"><strong>Profilaxis Aplicada:</strong> '
            + (rn && rn.vitamina_k ? '✓ Vitamina K 1 mg IM dosis única · ' : '')
            + (rn && rn.profilaxis_oftalmica ? '✓ Profilaxis oftálmica (Cloranfenicol) · ' : '')
            + (rn && rn.permeabilidad_coanas_esofago_ano ? '✓ Permeabilidad de coanas, esófago y ano verificada' : '')
            + '</div></div>'
            + '<div style="margin-bottom:8px;"><div style="font-weight:bold;font-size:10.5px;text-transform:uppercase;color:#0b3a5b;border-bottom:1px solid #cbd5e1;margin-bottom:3px;">3. Exploración Física Neonatal Completa</div><div style="white-space:pre-wrap;">' + e(rn && rn.exploracion_neonatal) + '</div></div>'
            + '<div style="margin-bottom:14px;"><div style="font-weight:bold;font-size:10.5px;text-transform:uppercase;color:#0b3a5b;border-bottom:1px solid #cbd5e1;margin-bottom:3px;">4. Destino e Indicaciones del Recién Nacido</div><div style="white-space:pre-wrap;font-weight:bold;">' + e(rn && rn.destino_rn) + '</div></div>'
            + '<footer style="margin-top:20px;display:flex;justify-content:space-around;text-align:center;page-break-inside:avoid;">'
            + '<div style="min-width:230px;border-top:1px solid #0f172a;padding-top:4px;font-size:10.5px;"><strong>' + e((rn && rn.medico_nombre) || '') + '</strong><br><span>' + e((rn && rn.medico_especialidad) || 'Pediatría') + '</span><br>' + cedulas + '</div>'
            + '<div style="min-width:210px;font-size:10.5px;"><div style="display:flex;gap:10px;justify-content:center;margin-bottom:4px;"><div style="width:2.6cm;height:3.2cm;border:1px dashed #64748b;font-size:8px;color:#64748b;display:flex;align-items:flex-end;justify-content:center;">Huella plantar RN</div><div style="width:2.2cm;height:2.6cm;border:1px dashed #64748b;font-size:8px;color:#64748b;display:flex;align-items:flex-end;justify-content:center;">Huella madre</div></div><div style="border-top:1px solid #0f172a;padding-top:4px;"><strong>Huella Plantar del RN / Firma Madre</strong><br><span style="font-size:9px;color:#64748b;">Identificación Neonatal NOM-007</span></div></div></footer></article>';
    }

    // ---------------------------------------------------------------- Hoja de Registro Transanestésico en Blanco para Llenado a Mano en Quirófano (NOM-006-SSA3-2011)
    function htmlHojaTransanestesicaBlanco(turnoId) {
        const e = escHtmlCuenta;
        const d = datosHojaTransanestesica(turnoId) || {};
        const horasCols = ["00'", "15'", "30'", "45'", "60'", "75'", "90'", "105'", "120'", "135'", "150'", "165'", "180'"];
        const filasSignos = ['TA Sistólica / Diastólica', 'Frecuencia Cardíaca (lpm)', 'SpO2 (%) / EtCO2', 'Frecuencia Resp. / Vent.', 'Temperatura (°C)', 'O2 (L/min) / Agente Inhalado'];
        return '<article style="font-family:Arial,sans-serif;color:#0f172a;max-width:20cm;margin:0 auto;font-size:10.5px;line-height:1.3;page-break-inside:avoid;">'
            + '<header style="display:flex;justify-content:center;align-items:center;border-bottom:2px solid #0b3a5b;padding-bottom:6px;margin-bottom:8px;">'
            + '<div style="text-align:right;"><div style="font-size:12.5px;font-weight:900;color:#0b3a5b;">HOJA DE REGISTRO TRANSANESTÉSICO</div><div style="font-size:9.5px;">Fecha: <strong>' + e(d.fecha || hoyLocal()) + '</strong> · Exp: <strong>' + e(d.expediente || '______') + '</strong></div></div></header>'
            + '<div style="border:1px solid #334155;border-radius:4px;padding:6px 8px;margin-bottom:8px;display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:5px;background:#f8fafc;">'
            + '<div><strong>Paciente:</strong> ' + e(d.paciente || '________________________________') + '</div>'
            + '<div><strong>Edad / Sexo:</strong> ' + e(d.edad || '____') + ' / ' + e(d.sexo || '__') + '</div>'
            + '<div><strong>Cama:</strong> ' + e(d.cama || '______') + '</div>'
            + '<div><strong>Peso / Talla:</strong> ' + e(d.peso || '____') + ' / ' + e(d.talla || '____') + '</div>'
            + '<div style="grid-column:span 2;"><strong>Procedimiento Programado:</strong> ' + e(d.procedimiento || '________________________________________') + '</div>'
            + '<div><strong>Cirujano:</strong> ' + e(d.cirujano || '____________________') + '</div>'
            + '<div><strong>Anestesiólogo:</strong> ' + e(d.anestesiologo || '____________________') + '</div>'
            + '<div style="grid-column:span 4;color:#991b1b;"><strong>Alergias:</strong> ' + e(d.alergias || 'NEGADAS') + ' &nbsp;|&nbsp; <strong>ASA:</strong> [ I ] [ II ] [ III ] [ IV ] [ E ] &nbsp;|&nbsp; <strong>Técnica Anestésica:</strong> [ ] Bloqueo Subaracnoideo &nbsp; [ ] Epidural &nbsp; [ ] Mixto &nbsp; [ ] Gral. Balanceada &nbsp; [ ] TIVA &nbsp; [ ] Sedación</div></div>'
            + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:8px;">'
            + '<div style="border:1px solid #475569;padding:4px 6px;"><strong>Hora Ingreso Sala:</strong> ________</div>'
            + '<div style="border:1px solid #475569;padding:4px 6px;"><strong>Inicio Anestesia:</strong> ________</div>'
            + '<div style="border:1px solid #475569;padding:4px 6px;"><strong>Inicio / Fin Qx:</strong> ____ / ____</div>'
            + '<div style="border:1px solid #475569;padding:4px 6px;"><strong>Fin Anestesia:</strong> ________</div></div>'
            + '<div style="font-weight:bold;font-size:10px;text-transform:uppercase;color:#0b3a5b;margin-bottom:3px;">1. Monitoreo de Signos Vitales Transanestésicos (Cada 5–15 min)</div>'
            + '<table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:9.5px;"><thead><tr style="background:#e2e8f0;"><th style="border:1px solid #334155;padding:3px 4px;text-align:left;width:22%;">Parámetro \\ Tiempo</th>'
            + horasCols.map(h => '<th style="border:1px solid #334155;padding:3px 2px;text-align:center;">' + h + '</th>').join('')
            + '</tr></thead><tbody>'
            + filasSignos.map(f => '<tr><td style="border:1px solid #334155;padding:5px 4px;font-weight:bold;">' + f + '</td>' + horasCols.map(() => '<td style="border:1px solid #334155;padding:5px 2px;">&nbsp;</td>').join('') + '</tr>').join('')
            + '</tbody></table>'
            + '<div style="display:grid;grid-template-columns:1.2fr 1fr;gap:8px;margin-bottom:8px;">'
            + '<div style="border:1px solid #334155;padding:5px 7px;"><div style="font-weight:bold;border-bottom:1px solid #94a3b8;margin-bottom:4px;">2. Medicamentos Administrados (Fármaco, Dosis, Vía y Hora)</div>'
            + '<div style="height:22px;border-bottom:1px dashed #cbd5e1;">1.</div><div style="height:22px;border-bottom:1px dashed #cbd5e1;">2.</div><div style="height:22px;border-bottom:1px dashed #cbd5e1;">3.</div><div style="height:22px;border-bottom:1px dashed #cbd5e1;">4.</div><div style="height:22px;border-bottom:1px dashed #cbd5e1;">5.</div><div style="height:22px;">6.</div></div>'
            + '<div style="border:1px solid #334155;padding:5px 7px;"><div style="font-weight:bold;border-bottom:1px solid #94a3b8;margin-bottom:4px;">3. Vía Aérea, Bloqueo Regional y Balance Hídrico</div>'
            + '<div style="margin-bottom:4px;"><strong>Vía Aérea / Cánula / TET:</strong> _______________________</div>'
            + '<div style="margin-bottom:4px;"><strong>Aguja / Nivel Bloqueo:</strong> _________________________</div>'
            + '<div style="margin-bottom:4px;"><strong>Ingresos:</strong> Cristaloides: _______ ml | Coloides/Hemod.: _______ ml</div>'
            + '<div style="margin-bottom:4px;"><strong>Egresos:</strong> Sangrado: _____ ml | Uresis: _____ ml | Otros: _____ ml</div>'
            + '<div><strong>Balance Total:</strong> _________________ ml</div></div></div>'
            + '<div style="border:1px solid #334155;padding:5px 7px;margin-bottom:10px;"><div style="font-weight:bold;border-bottom:1px solid #94a3b8;margin-bottom:4px;">4. Incidentes Transanestésicos, Emersión y Escala de Aldrete al Egreso de Sala</div>'
            + '<div style="height:32px;border-bottom:1px dashed #cbd5e1;">Observaciones:</div>'
            + '<div style="margin-top:4px;"><strong>Aldrete al pasar a Recuperación:</strong> Actividad (0-2): ___ | Respiración (0-2): ___ | Circulación (0-2): ___ | Conciencia (0-2): ___ | SpO2 (0-2): ___ = <strong>Total: ____ / 10 pts</strong> &nbsp; (Bromage: ____)</div></div>'
            + '<footer style="margin-top:18px;text-align:center;page-break-inside:avoid;"><div style="display:inline-block;min-width:260px;border-top:1px solid #0f172a;padding-top:4px;font-size:10.5px;"><strong>' + e(d.anestesiologo || 'Médico Anestesiólogo Responsable') + '</strong><br><span>' + e(d.cedulas_anestesiologo || 'Nombre, Cédula Profesional / Especialidad y Firma') + '</span></div></footer></article>';
    }


    // ---------------------------------------------------------------- Nota de Atención de Parto Eutócico y Alumbramiento (NOM-007-SSA2-2016)
    function guardarNotaParto(turnoId, entrada, s) {
        const i = asegurarInternamiento(turnoId);
        const t = obtenerTurno(turnoId);
        if (!i || !t) return { ok: false, motivo: 'No se encontró el internamiento activo.' };
        if (!s || (s.rol !== 'medico' && s.rol !== 'admin')) return { ok: false, motivo: 'Solo el médico tratante / Gineco-Obstetra o Dirección pueden registrar la Nota de Parto.' };
        const e = Object.assign({}, entrada || {});
        const u = USUARIOS[s.usuario_id] || {};
        const lista = i.notas_parto || [];
        const parto = {
            parto_id: uid('PARTO'),
            folio: 'PARTO-' + pad3(lista.length + 1),
            fecha_hora: e.fecha_hora || new Date().toISOString(),
            hora_ingreso_labor: e.hora_ingreso_labor || '06:30 hrs',
            hora_expulsion: e.hora_expulsion || '11:15 hrs',
            hora_alumbramiento: e.hora_alumbramiento || '11:22 hrs',
            autor_id: s.usuario_id,
            autor_nombre: u.nombre || s.nombre,
            autor_especialidad: especialidadImpresaMedico(u) || 'Ginecología y Obstetricia',
            cedulas_impresas: textoCedulasFirma(u) || '',
            formula_obstetrica: limpiarEspacios(e.formula_obstetrica || 'G2 P1 C0 A0'),
            sdg: limpiarEspacios(e.sdg || '39.5 SDG'),
            exploracion_obstetrica: limpiarEspacios(e.exploracion_obstetrica || 'AFU 33 cm · Maniobras de Leopold: producto único vivo, longitudinal, cefálico, dorso izquierdo · FCF 148 lpm · Dinámica uterina: 4 contracciones en 10 min de 45 s (+++) · Tacto vaginal: dilatación 10 cm, borramiento 100%, DeLee +2, pelvis ginecoide suficiente, membranas rotas con líquido amniótico claro.'),
            tipo_parto: limpiarEspacios(e.tipo_parto || 'Parto Eutócico Cefalovaginal'),
            conduccion_oxitocina: limpiarEspacios(e.conduccion_oxitocina || 'Conducción con Oxitocina 5 UI en 500 ml Sol. Glucosada 5% + Manejo activo del 3er periodo (10 UI IM)'),
            analgesia_obstetrica: limpiarEspacios(e.analgesia_obstetrica || 'Bloqueo peridural obstétrico + Infiltración perineal con Lidocaína 2% simple'),
            episiotomia: limpiarEspacios(e.episiotomia || 'Mediolateral derecha con episiorrafia por planos con Catgut Crómico 2-0 (sin desgarros adicionales)'),
            tipo_alumbramiento: limpiarEspacios(e.tipo_alumbramiento || 'Dirigido mecanismo de Schultze (completo a los 7 min)'),
            placenta_membranas: limpiarEspacios(e.placenta_membranas || 'Placenta completa (cotiledones íntegros) y membranas corioamnióticas completas · Cordón con 2 arterias y 1 vena'),
            tono_uterino_cavidad: limpiarEspacios(e.tono_uterino_cavidad || 'Útero bien contraído (Globo de seguridad de Pinard presente), canal vaginal y cérvix revisados sin laceraciones activas'),
            sangrado_ml: parseInt(e.sangrado_ml, 10) || 250,
            rn_sexo: limpiarEspacios(e.rn_sexo || 'Masculino'),
            rn_peso_gramos: parseInt(String(e.rn_peso_gramos || e.peso_gramos || '3410').replace(/[^0-9]/g, ''), 10) || 3410,
            rn_talla_cm: parseFloat(String(e.rn_talla_cm || e.talla_cm || '51').replace(/[^0-9.]/g, '')) || 51,
            rn_apgar: limpiarEspacios(e.rn_apgar || '9 / 9'),
            rn_silverman: limpiarEspacios(e.rn_silverman || '0 (Sin dificultad respiratoria)'),
            rn_capurro: limpiarEspacios(e.rn_capurro || '39.5 SDG'),
            pinzamiento_apego: limpiarEspacios(e.pinzamiento_apego || 'Pinzamiento tardío de cordón umbilical (60 s), apego inmediato piel con piel e inicio de lactancia materna en la primera hora'),
            plan_puerperio: expandirAbreviaturasMedicas(limpiarEspacios(e.plan_puerperio || 'Pasa a piso de Maternidad en alojamiento conjunto. Vigilancia estrecha de involución uterina, sangrado transvaginal y signos vitales cada 30 min por 2 horas. Dieta normal con abundantes líquidos, deambulación asistida, analgesia con Paracetamol 1 g IV c/8h + Ketorolaco 30 mg IV c/8h.')),
            pronostico: limpiarEspacios(e.pronostico || 'Bueno para el binomio madre-hijo')
        };
        i.notas_parto = lista.concat([parto]);
        i.nota_parto = parto;
        guardarInternamiento(i);
        let rnRes = null;
        if (e.generar_hoja_rn !== false) {
            const ap = String(parto.rn_apgar).split('/');
            rnRes = guardarHojaRecienNacido(turnoId, {
                sexo_rn: parto.rn_sexo,
                via_nacimiento: parto.tipo_parto,
                fecha_hora_nacimiento: parto.fecha_hora,
                peso_gramos: parto.rn_peso_gramos,
                talla_cm: parto.rn_talla_cm,
                apgar_1: limpiarEspacios(ap[0] || '9'),
                apgar_5: limpiarEspacios(ap[1] || '9'),
                silverman: parto.rn_silverman,
                capurro_sdg: parto.rn_capurro,
                reanimacion: parto.pinzamiento_apego,
                destino_rn: 'Alojamiento conjunto con la madre · Lactancia materna exclusiva a libre demanda.'
            }, USUARIOS.dr_carlos_ped ? Object.assign({}, USUARIOS.dr_carlos_ped, { usuario_id: 'dr_carlos_ped', medico_id: 'dr_carlos_ped' }) : s);
        }
        return { ok: true, parto: parto, recien_nacido: rnRes && rnRes.recien_nacido, internamiento: obtenerInternamiento(i.internamiento_id) };
    }

    function htmlImpresionNotaParto(parto, turnoId) {
        const e = escHtmlCuenta;
        const t = obtenerTurno(turnoId) || {};
        const i = internamientoDeTurno(turnoId) || {};
        const p = (t.paciente_id && buscarPacientePorId(t.paciente_id)) || {};
        const nombrePac = p.nombre_completo || t.paciente_nombre || 'Paciente';
        const edadTxt = formatearEdad(p.fecha_nacimiento || t.fecha_nacimiento, calcularEdad(p.fecha_nacimiento || t.fecha_nacimiento));
        const cedulas = e((parto && parto.cedulas_impresas) || '').replace(/\n/g, '<br>');
        return '<article style="font-family:Arial,sans-serif;color:#0f172a;max-width:19.5cm;margin:0 auto;font-size:11px;line-height:1.38;page-break-inside:avoid;">'
            + '<header style="display:flex;justify-content:center;align-items:center;border-bottom:2px solid #0b3a5b;padding-bottom:8px;margin-bottom:10px;">'
            + '<div style="text-align:right;"><div style="font-size:13px;font-weight:900;color:#be185d;text-transform:uppercase;">NOTA DE ATENCIÓN DE PARTO Y ALUMBRAMIENTO</div><div style="font-size:10px;color:#475569;">NOM-007-SSA2-2016 / NOM-004 · Folio: <strong>' + e((parto && parto.folio) || 'PARTO-001') + '</strong></div></div></header>'
            + '<div style="background:#fdf2f8;border:1px solid #f9a8d4;border-radius:6px;padding:8px 10px;margin-bottom:10px;display:grid;grid-template-columns:2fr 1fr 1fr;gap:6px;">'
            + '<div><strong>Paciente (Madre):</strong> ' + e(nombrePac) + '</div><div><strong>Edad:</strong> ' + e(edadTxt) + '</div><div><strong>Expediente:</strong> ' + e(t.paciente_id || 'S/N') + '</div>'
            + '<div><strong>Fórmula Obstétrica:</strong> ' + e((parto && parto.formula_obstetrica) || 'G2 P1 C0 A0') + ' · <strong>SDG:</strong> ' + e((parto && parto.sdg) || '39.5 SDG') + '</div>'
            + '<div><strong>Cama:</strong> ' + e(i.cama || 'Maternidad') + '</div><div><strong>Fecha:</strong> ' + e(fechaHoraLegible(parto && parto.fecha_hora)) + '</div>'
            + '<div style="grid-column:span 3;"><strong>Cronometría Obstétrica:</strong> Ingreso a labor: <strong>' + e((parto && parto.hora_ingreso_labor) || '06:30 hrs') + '</strong> · Hora de Nacimiento (Expulsión): <strong>' + e((parto && parto.hora_expulsion) || '11:15 hrs') + '</strong> · Hora de Alumbramiento: <strong>' + e((parto && parto.hora_alumbramiento) || '11:22 hrs') + '</strong></div></div>'
            + '<div style="margin-bottom:8px;"><div style="font-weight:bold;font-size:10.5px;text-transform:uppercase;color:#0b3a5b;border-bottom:1px solid #cbd5e1;margin-bottom:3px;">1. Exploración Obstétrica y Trabajo de Parto (Leopold, FCF, Dinámica Uterina y Tacto Vaginal)</div><div style="white-space:pre-wrap;">' + e((parto && parto.exploracion_obstetrica) || '') + '</div></div>'
            + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">'
            + '<div style="border:1px solid #cbd5e1;border-radius:6px;padding:6px 8px;"><strong>Tipo de Parto:</strong> ' + e((parto && parto.tipo_parto) || 'Parto Eutócico') + '<br><strong>Analgesia Obstétrica:</strong> ' + e((parto && parto.analgesia_obstetrica) || '') + '</div>'
            + '<div style="border:1px solid #cbd5e1;border-radius:6px;padding:6px 8px;"><strong>Conducción / Oxitócicos:</strong> ' + e((parto && parto.conduccion_oxitocina) || '') + '<br><strong>Episiotomía / Periné:</strong> ' + e((parto && parto.episiotomia) || '') + '</div></div>'
            + '<div style="margin-bottom:8px;"><div style="font-weight:bold;font-size:10.5px;text-transform:uppercase;color:#0b3a5b;border-bottom:1px solid #cbd5e1;margin-bottom:3px;">2. Tercer Periodo del Parto (Alumbramiento, Placenta y Sangrado)</div>'
            + '<div><strong>Mecanismo de Alumbramiento:</strong> ' + e((parto && parto.tipo_alumbramiento) || 'Schultze') + ' · <strong>Sangrado Estimado:</strong> ' + e((parto && parto.sangrado_ml) || 250) + ' ml</div>'
            + '<div><strong>Placenta y Membranas:</strong> ' + e((parto && parto.placenta_membranas) || '') + '</div>'
            + '<div><strong>Tono Uterino y Revisión del Canal del Parto:</strong> ' + e((parto && parto.tono_uterino_cavidad) || '') + '</div></div>'
            + '<div style="margin-bottom:8px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;padding:7px 10px;"><div style="font-weight:bold;font-size:10.5px;text-transform:uppercase;color:#0b3a5b;margin-bottom:4px;">3. Datos del Recién Nacido y Apego Inmediato</div>'
            + '<div><strong>Sexo:</strong> ' + e((parto && parto.rn_sexo) || '') + ' · <strong>Peso:</strong> ' + e((parto && parto.rn_peso_gramos) || '') + ' g · <strong>Talla:</strong> ' + e((parto && parto.rn_talla_cm) || '') + ' cm · <strong>Apgar (1 min / 5 min):</strong> ' + e((parto && parto.rn_apgar) || '') + ' · <strong>Silverman:</strong> ' + e((parto && parto.rn_silverman) || '') + ' · <strong>Capurro:</strong> ' + e((parto && parto.rn_capurro) || '') + '</div>'
            + '<div><strong>Pinzamiento y Lactancia:</strong> ' + e((parto && parto.pinzamiento_apego) || '') + '</div></div>'
            + '<div style="margin-bottom:12px;"><div style="font-weight:bold;font-size:10.5px;text-transform:uppercase;color:#0b3a5b;border-bottom:1px solid #cbd5e1;margin-bottom:3px;">4. Indicaciones de Puerperio Inmediato y Pronóstico</div><div style="white-space:pre-wrap;">' + e((parto && parto.plan_puerperio) || '') + '</div><div style="margin-top:4px;"><strong>Pronóstico:</strong> ' + e((parto && parto.pronostico) || 'Bueno para el binomio') + '</div></div>'
            + '<footer style="margin-top:20px;text-align:center;page-break-inside:avoid;"><div style="display:inline-block;min-width:260px;border-top:1px solid #0f172a;padding-top:4px;font-size:10.5px;"><strong>' + e((parto && parto.autor_nombre) || '') + '</strong><br><span>' + e((parto && parto.autor_especialidad) || 'Ginecología y Obstetricia') + '</span><br>' + cedulas + '</div></footer></article>';
    }

    // ---------------------------------------------------------------- Formatos Imprimibles de Anestesiología (Pre, Trans y Postanestésica con Recetas)
    function htmlImpresionNotaPreanestesica(nota, turnoId) {
        const e = escHtmlCuenta;
        const d = datosHojaTransanestesica(turnoId) || {};
        const n = nota || {};
        const meds = n.medicamentos_solicitados || [];
        return '<article style="font-family:Arial,sans-serif;color:#0f172a;max-width:19.5cm;margin:0 auto;font-size:11px;line-height:1.38;page-break-inside:avoid;">'
            + '<header style="display:flex;justify-content:center;align-items:center;border-bottom:2px solid #0b3a5b;padding-bottom:8px;margin-bottom:10px;">'
            + '<div style="text-align:right;"><div style="font-size:13px;font-weight:900;color:#4c1d95;text-transform:uppercase;">NOTA DE VALORACIÓN PREANESTÉSICA</div><div style="font-size:10px;color:#475569;">NOM-006-SSA3-2011 · Folio: <strong>' + e(n.folio || 'PRE-001') + '</strong></div></div></header>'
            + '<div style="background:#f5f3ff;border:1px solid #c4b5fd;border-radius:6px;padding:8px 10px;margin-bottom:10px;display:grid;grid-template-columns:2fr 1fr 1fr;gap:6px;">'
            + '<div><strong>Paciente:</strong> ' + e(d.nombre || d.paciente) + ' (' + e(d.edad_texto || d.edad) + ', ' + e(d.sexo) + ')</div><div><strong>Expediente:</strong> ' + e(d.expediente) + '</div><div><strong>Cama:</strong> ' + e(d.cama) + '</div>'
            + '<div><strong>Diagnóstico Preoperatorio:</strong> ' + e(d.diagnostico) + '</div><div><strong>Peso / Talla / IMC:</strong> ' + e(d.peso) + ' kg · ' + e(d.talla) + ' m (IMC ' + e(d.imc) + ')</div><div><strong>Grupo / Alergias:</strong> ' + e(d.grupo_rh) + ' · ' + e(d.alergias) + '</div>'
            + '<div style="grid-column:span 2;"><strong>Procedimiento Proyectado:</strong> ' + e(d.procedimiento) + ' · <strong>Cirujano:</strong> ' + e(d.cirujano) + '</div><div><strong>Fecha:</strong> ' + e(fechaHoraLegible(n.fecha_hora)) + '</div></div>'
            + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px;">'
            + '<div style="border:1px solid #cbd5e1;border-radius:5px;padding:6px;"><strong>Riesgo ASA:</strong><br>' + e(n.asa || d.asa || 'ASA II') + '</div>'
            + '<div style="border:1px solid #cbd5e1;border-radius:5px;padding:6px;"><strong>Vía Aérea (Mallampati):</strong><br>' + e(n.mallampati || d.mallampati || 'Clase II') + '</div>'
            + '<div style="border:1px solid #cbd5e1;border-radius:5px;padding:6px;"><strong>Horas de Ayuno:</strong><br>' + e(n.ayuno_horas || d.ayuno_horas || '8 horas') + '</div>'
            + '<div style="border:1px solid #cbd5e1;border-radius:5px;padding:6px;"><strong>Técnica Planeada:</strong><br>' + e(n.tecnica_planeada || d.tecnica_planeada || 'General balanceada') + '</div></div>'
            + '<div style="margin-bottom:8px;"><div style="font-weight:bold;font-size:10.5px;text-transform:uppercase;color:#0b3a5b;border-bottom:1px solid #cbd5e1;margin-bottom:3px;">1. Valoración Clínica Preanestésica, Signos Vitales Basales y Plan Anestésico</div>'
            + '<div style="margin-bottom:4px;font-size:10.5px;color:#334155;"><strong>Signos Basales:</strong> TA ' + e(d.ta) + ' · FC ' + e(d.fc) + ' · FR ' + e(d.fr) + ' · Temp ' + e(d.temp) + ' · SpO2 ' + e(d.spo2) + '</div>'
            + '<div style="white-space:pre-wrap;">' + e(n.valoracion || n.plan || '') + '</div></div>'
            + '<div style="margin-bottom:12px;"><div style="font-weight:bold;font-size:10.5px;text-transform:uppercase;color:#4c1d95;border-bottom:1px solid #c4b5fd;margin-bottom:4px;">2. Solicitud Estimada de Medicamentos Anestésicos y Controlados para Quirófano (Sin descuento en caja hasta conciliación postanestésica)</div>'
            + (meds.length ? '<table style="width:100%;border-collapse:collapse;font-size:10.5px;"><thead><tr style="background:#f1f5f9;"><th style="border:1px solid #cbd5e1;padding:4px 6px;text-align:left;">Clave / Medicamento</th><th style="border:1px solid #cbd5e1;padding:4px 6px;text-align:center;">Fracción COFEPRIS</th><th style="border:1px solid #cbd5e1;padding:4px 6px;text-align:center;">Ámpulas Estimadas</th><th style="border:1px solid #cbd5e1;padding:4px 6px;text-align:left;">Vía / Nota</th><th style="border:1px solid #cbd5e1;padding:4px 6px;text-align:center;">Estado en Caja</th></tr></thead><tbody>'
                + meds.map(m => '<tr><td style="border:1px solid #cbd5e1;padding:4px 6px;"><strong>' + e(m.sku) + '</strong> — ' + e(m.nombre) + '</td><td style="border:1px solid #cbd5e1;padding:4px 6px;text-align:center;">Fracción ' + e(m.fraccion) + '</td><td style="border:1px solid #cbd5e1;padding:4px 6px;text-align:center;font-weight:bold;">' + e(m.cantidad_estimada) + '</td><td style="border:1px solid #cbd5e1;padding:4px 6px;">' + e(m.dosis_planeada || m.via || 'IV · Dosis respuesta') + '</td><td style="border:1px solid #cbd5e1;padding:4px 6px;text-align:center;color:#b45309;">Solicitud previa (No descontado)</td></tr>').join('')
                + '</tbody></table>' : '<div>Sin medicamentos controlados estimados.</div>')
            + '</div>'
            + '<footer style="margin-top:20px;text-align:center;page-break-inside:avoid;"><div style="display:inline-block;min-width:260px;border-top:1px solid #0f172a;padding-top:4px;font-size:10.5px;"><strong>' + e(n.autor_nombre || d.anestesiologo) + '</strong><br><span>Médico Anestesiólogo · ' + e(n.cedulas_impresas || d.cedulas_anestesiologo) + '</span></div></footer></article>';
    }

    function htmlImpresionRegistroTransanestesico(reg, turnoId) {
        const e = escHtmlCuenta;
        const d = datosHojaTransanestesica(turnoId) || {};
        const r = reg || {};
        const mon = r.monitoreo_15min || r.signos_trans || [
            { hora: '09:00', ta: '124/78', fc: '76', fr: '14', spo2: '99%', etco2: '35', evento: 'Inducción anestésica / Sedación + Inicio de procedimiento sin incidentes' },
            { hora: '09:15', ta: '118/74', fc: '72', fr: '14', spo2: '99%', etco2: '34', evento: 'Incisión quirúrgica / Mantenimiento anestésico estable' },
            { hora: '09:30', ta: '120/76', fc: '74', fr: '14', spo2: '99%', etco2: '34', evento: 'Transoperatorio hemodinámicamente estable' },
            { hora: '09:45', ta: '116/72', fc: '70', fr: '14', spo2: '99%', etco2: '35', evento: 'Hemostasia y cierre por planos' },
            { hora: '10:00', ta: '120/75', fc: '74', fr: '16', spo2: '99%', etco2: '36', evento: 'Emersión anestésica / Pase a Recuperación' }
        ];
        return '<article style="font-family:Arial,sans-serif;color:#0f172a;max-width:19.5cm;margin:0 auto;font-size:10.5px;line-height:1.35;page-break-inside:avoid;">'
            + '<header style="display:flex;justify-content:center;align-items:center;border-bottom:2px solid #0b3a5b;padding-bottom:6px;margin-bottom:8px;">'
            + '<div style="text-align:right;"><div style="font-size:12.5px;font-weight:900;color:#0b3a5b;text-transform:uppercase;">HOJA DE REGISTRO TRANSANESTÉSICO</div><div style="font-size:9.5px;color:#475569;">Folio: <strong>' + e(r.folio || 'TRA-001') + '</strong> · Fecha: <strong>' + e(fechaHoraLegible(r.fecha_hora || d.fecha)) + '</strong></div></div></header>'
            + '<div style="background:#f8fafc;border:1px solid #94a3b8;border-radius:5px;padding:6px 8px;margin-bottom:8px;display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:4px;">'
            + '<div><strong>Paciente:</strong> ' + e(d.nombre || d.paciente) + '</div><div><strong>Edad/Sexo:</strong> ' + e(d.edad_texto || d.edad) + ' · ' + e(d.sexo) + '</div><div><strong>Exp:</strong> ' + e(d.expediente) + '</div><div><strong>Cama/Sala:</strong> ' + e(d.cama) + ' / ' + e(d.sala) + '</div>'
            + '<div><strong>Peso/Talla/IMC:</strong> ' + e(d.peso) + ' kg · ' + e(d.talla) + ' m · IMC ' + e(d.imc) + '</div><div><strong>Grupo/Rh:</strong> ' + e(d.grupo_rh) + '</div><div style="grid-column:span 2;"><strong>Alergias:</strong> <span style="color:#b91c1c;font-weight:bold;">' + e(d.alergias) + '</span></div>'
            + '<div style="grid-column:span 2;"><strong>Diagnóstico:</strong> ' + e(d.diagnostico) + '</div><div style="grid-column:span 2;"><strong>Cirugía:</strong> ' + e(d.procedimiento) + '</div>'
            + '<div style="grid-column:span 2;"><strong>Cirujano:</strong> ' + e(d.cirujano) + '</div><div style="grid-column:span 2;"><strong>Anestesiólogo:</strong> ' + e(r.autor_nombre || d.anestesiologo) + ' (' + e(d.cedulas_anestesiologo) + ')</div>'
            + '<div style="grid-column:span 4;"><strong>Signos Basales:</strong> TA ' + e(d.ta) + ' · FC ' + e(d.fc) + ' · FR ' + e(d.fr) + ' · Temp ' + e(d.temp) + ' · SpO2 ' + e(d.spo2) + ' · <strong>ASA:</strong> ' + e(d.asa) + ' · <strong>Técnica:</strong> ' + e(r.tecnica || d.tecnica_planeada) + '</div></div>'
            + '<div style="margin-bottom:8px;"><div style="font-weight:bold;font-size:10px;text-transform:uppercase;color:#0b3a5b;margin-bottom:3px;">1. Monitoreo Hemodinámico y Ventilatorio Transanestésico (Cada 15 min)</div>'
            + '<table style="width:100%;border-collapse:collapse;font-size:10px;"><thead><tr style="background:#e2e8f0;"><th style="border:1px solid #94a3b8;padding:3px 5px;">Hora</th><th style="border:1px solid #94a3b8;padding:3px 5px;">TA (mmHg)</th><th style="border:1px solid #94a3b8;padding:3px 5px;">FC (lpm)</th><th style="border:1px solid #94a3b8;padding:3px 5px;">FR (rpm)</th><th style="border:1px solid #94a3b8;padding:3px 5px;">SpO2</th><th style="border:1px solid #94a3b8;padding:3px 5px;">EtCO2</th><th style="border:1px solid #94a3b8;padding:3px 5px;text-align:left;">Evento Quirúrgico / Fármacos Administrados</th></tr></thead><tbody>'
            + mon.map(m => '<tr><td style="border:1px solid #94a3b8;padding:3px 5px;text-align:center;font-weight:bold;">' + e(m.hora) + '</td><td style="border:1px solid #94a3b8;padding:3px 5px;text-align:center;">' + e(m.ta) + '</td><td style="border:1px solid #94a3b8;padding:3px 5px;text-align:center;">' + e(m.fc) + '</td><td style="border:1px solid #94a3b8;padding:3px 5px;text-align:center;">' + e(m.fr) + '</td><td style="border:1px solid #94a3b8;padding:3px 5px;text-align:center;">' + e(m.spo2) + '</td><td style="border:1px solid #94a3b8;padding:3px 5px;text-align:center;">' + e(m.etco2 || '35') + '</td><td style="border:1px solid #94a3b8;padding:3px 5px;">' + e(m.evento) + '</td></tr>').join('')
            + '</tbody></table></div>'
            + '<div style="margin-bottom:10px;"><div style="font-weight:bold;font-size:10px;text-transform:uppercase;color:#0b3a5b;border-bottom:1px solid #cbd5e1;margin-bottom:3px;">2. Balance Hídrico, Medicación Transanestésica y Observaciones</div>'
            + '<div style="white-space:pre-wrap;">' + e(r.registros || r.notas || r.texto || r.balance_hidrico || 'Ingresos: Sol. Hartmann 1,000 ml IV · Egresos: Uresis 250 ml, Sangrado estimado 80 ml · Balance positivo +670 ml. Sin incidentes transanestésicos.') + '</div></div>'
            + '<footer style="margin-top:16px;text-align:center;page-break-inside:avoid;"><div style="display:inline-block;min-width:260px;border-top:1px solid #0f172a;padding-top:4px;font-size:10px;"><strong>' + e(r.autor_nombre || d.anestesiologo) + '</strong><br><span>Médico Anestesiólogo · ' + e(d.cedulas_anestesiologo) + '</span></div></footer></article>';
    }

    function htmlImpresionNotaPostanestesica(nota, turnoId) {
        const e = escHtmlCuenta;
        const d = datosHojaTransanestesica(turnoId) || {};
        const n = nota || {};
        const conc = n.conciliacion_medicamentos || [];
        const recs = n.recetas_foliadas || [];
        const sig = n.signos_egreso_qx || {};
        return '<article style="font-family:Arial,sans-serif;color:#0f172a;max-width:19.5cm;margin:0 auto;font-size:11px;line-height:1.38;page-break-inside:avoid;">'
            + '<header style="display:flex;justify-content:center;align-items:center;border-bottom:2px solid #0b3a5b;padding-bottom:8px;margin-bottom:10px;">'
            + '<div style="text-align:right;"><div style="font-size:13px;font-weight:900;color:#0b3a5b;text-transform:uppercase;">NOTA POSTANESTÉSICA Y CONCILIACIÓN DE CONTROLADOS</div><div style="font-size:10px;color:#475569;">NOM-006-SSA3-2011 · Folio: <strong>' + e(n.folio || 'PA-001') + '</strong></div></div></header>'
            + '<div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;padding:8px 10px;margin-bottom:10px;display:grid;grid-template-columns:2fr 1fr 1fr;gap:6px;">'
            + '<div><strong>Paciente:</strong> ' + e(d.nombre || d.paciente) + ' (' + e(d.edad_texto || d.edad) + ', ' + e(d.sexo) + ')</div><div><strong>Expediente:</strong> ' + e(d.expediente) + '</div><div><strong>Cama:</strong> ' + e(d.cama) + '</div>'
            + '<div><strong>Procedimiento Realizado:</strong> ' + e(d.procedimiento) + '</div><div><strong>Técnica Anestésica:</strong> ' + e(n.tecnica_texto || n.tecnica || 'General balanceada') + '</div><div><strong>Fecha:</strong> ' + e(fechaHoraLegible(n.fecha_hora)) + '</div>'
            + '<div><strong>Escala de Aldrete al Egreso:</strong> <strong>' + e(n.aldrete != null ? n.aldrete : 9) + ' / 10 pts</strong></div><div><strong>Sangrado:</strong> ' + e(n.sangrado != null ? n.sangrado : '80 ml') + '</div><div><strong>Signos Egreso Qx:</strong> TA ' + e(sig.ta || '118/74') + ' · FC ' + e(sig.fc || '74') + ' · SpO2 ' + e(sig.spo2 || '98') + '%</div></div>'
            + '<div style="margin-bottom:10px;"><div style="font-weight:bold;font-size:10.5px;text-transform:uppercase;color:#0b3a5b;border-bottom:1px solid #cbd5e1;margin-bottom:4px;">1. Conciliación de Medicamentos y Ámpulas Realmente Utilizadas en Quirófano (COFEPRIS)</div>'
            + (conc.length ? '<table style="width:100%;border-collapse:collapse;font-size:10px;"><thead><tr style="background:#e2e8f0;"><th style="border:1px solid #cbd5e1;padding:4px 6px;text-align:left;">Medicamento</th><th style="border:1px solid #cbd5e1;padding:4px 6px;text-align:center;">Fracción</th><th style="border:1px solid #cbd5e1;padding:4px 6px;text-align:center;">Estimadas (Pre)</th><th style="border:1px solid #cbd5e1;padding:4px 6px;text-align:center;">Usadas Reales</th><th style="border:1px solid #cbd5e1;padding:4px 6px;text-align:left;">Dosis / Merma / Lote</th><th style="border:1px solid #cbd5e1;padding:4px 6px;text-align:center;">Folio Receta Generada</th></tr></thead><tbody>'
                + conc.map(c => '<tr><td style="border:1px solid #cbd5e1;padding:4px 6px;"><strong>' + e(c.sku) + '</strong> — ' + e(c.nombre) + '</td><td style="border:1px solid #cbd5e1;padding:4px 6px;text-align:center;font-weight:bold;">Fracción ' + e(c.fraccion) + '</td><td style="border:1px solid #cbd5e1;padding:4px 6px;text-align:center;">' + e(c.cantidad_estimada) + '</td><td style="border:1px solid #cbd5e1;padding:4px 6px;text-align:center;font-weight:bold;color:#047857;">' + e(c.cantidad_real) + '</td><td style="border:1px solid #cbd5e1;padding:4px 6px;">' + e(c.dosis_administrada || '') + ' · Merma: ' + e(c.merma || '0 ml') + ' · Lote: ' + e(c.lote || 'S/L') + '</td><td style="border:1px solid #cbd5e1;padding:4px 6px;text-align:center;font-weight:bold;color:#4c1d95;">' + e(c.folio_receta || '—') + '</td></tr>').join('')
                + '</tbody></table>' : '<div>Sin medicamentos conciliados.</div>')
            + (recs.length ? '<div style="margin-top:6px;background:#ecfdf5;border:1px solid #6ee7b7;border-radius:5px;padding:5px 8px;font-size:10px;color:#065f46;"><strong>Recetas Oficiales Generadas Automáticamente:</strong> ' + recs.map(r => 'Folio <strong>' + e(r.folio) + '</strong> (Fracción ' + e(r.fraccion) + ')').join(' · ') + '</div>' : '')
            + '</div>'
            + '<div style="margin-bottom:8px;"><div style="font-weight:bold;font-size:10.5px;text-transform:uppercase;color:#0b3a5b;border-bottom:1px solid #cbd5e1;margin-bottom:3px;">2. Incidentes Transanestésicos</div><div style="white-space:pre-wrap;">' + e(n.incidentes || 'Sin incidentes ni accidentes anestésicos.') + '</div></div>'
            + '<div style="margin-bottom:14px;"><div style="font-weight:bold;font-size:10.5px;text-transform:uppercase;color:#0b3a5b;border-bottom:1px solid #cbd5e1;margin-bottom:3px;">3. Evolución Postanestésica e Indicaciones de Recuperación</div><div style="white-space:pre-wrap;">' + e(n.evolucion || '') + '</div></div>'
            + '<footer style="margin-top:20px;text-align:center;page-break-inside:avoid;"><div style="display:inline-block;min-width:260px;border-top:1px solid #0f172a;padding-top:4px;font-size:10.5px;"><strong>' + e(n.autor_nombre || d.anestesiologo) + '</strong><br><span>' + e(n.autor_especialidad || 'Anestesiología') + ' · ' + e(n.cedulas_impresas || d.cedulas_anestesiologo) + '</span></div></footer></article>';
    }


    // ---------------------------------------------------------------- Solicitud de Estudios (Laboratorio y Gabinete) en Hospitalización y Confirmación por Enfermería
    function solicitarEstudiosHospital(turnoId, entrada, s) {
        const i = obtenerInternamiento(turnoId) || asegurarInternamiento(turnoId);
        const t = obtenerTurno((i && i.turno_id) || turnoId);
        if (!i || !t) return { ok: false, motivo: 'No se encontró el internamiento.' };
        if (!s || (s.rol !== 'medico' && s.rol !== 'admin')) return { ok: false, motivo: 'Solo el personal médico puede solicitar estudios.' };
        const items = Array.isArray(entrada && entrada.estudios) ? entrada.estudios : [];
        if (!items.length) return { ok: false, motivo: 'Seleccione al menos un estudio de laboratorio o gabinete.' };
        const ahora = new Date();
        const modoProg = (entrada && entrada.modo_programacion) || 'AHORA'; // AHORA | EN_HORAS | MANANA | HORA_ESPECIFICA
        let fechaProgTxt = 'Inmediato / Ahora mismo';
        let fechaObjetivoIso = ahora.toISOString();
        if (modoProg === 'EN_HORAS') {
            const hrs = Math.max(1, Number(entrada.horas || 2));
            const dt = new Date(ahora.getTime() + hrs * 3600000);
            fechaObjetivoIso = dt.toISOString();
            fechaProgTxt = 'En ' + hrs + ' hora(s) (' + dt.toTimeString().slice(0, 5) + ' hrs)';
        } else if (modoProg === 'MANANA') {
            const dt = new Date(ahora.getTime() + 24 * 3600000);
            const horaM = limpiarEspacios(entrada.hora_especifica || '07:00');
            fechaProgTxt = 'Mañana a las ' + horaM + ' hrs';
            fechaObjetivoIso = dt.toISOString().slice(0, 10) + 'T' + horaM + ':00';
        } else if (modoProg === 'HORA_ESPECIFICA') {
            const hEsp = limpiarEspacios(entrada.hora_especifica || '08:00');
            fechaProgTxt = 'Programado a las ' + hEsp + ' hrs';
        }
        const catalogo = listarEstudios();
        const ordenId = uid('ORD-EST');
        const estudiosCreados = items.map(it => {
            const codigo = typeof it === 'string' ? it : (it.estudio_id || it.codigo || '');
            const cat = catalogo.find(x => x.estudio_id === codigo || normalizar(x.nombre) === normalizar(it.nombre || codigo)) || {};
            return {
                item_id: uid('EST-IT'),
                orden_id: ordenId,
                estudio_id: cat.estudio_id || codigo || 'EST-LIBRE',
                nombre: cat.nombre || it.nombre || codigo,
                categoria: cat.categoria || it.categoria || (/tomograf|tac|rayos|rx|ultrasonido|usg|electro|ekg|ecg/i.test(cat.nombre || it.nombre || '') ? 'IMAGEN' : 'LABORATORIO'),
                recipiente: cat.recipiente || it.recipiente || '',
                precio_unitario: Number(cat.precio_unitario != null ? cat.precio_unitario : (it.precio_unitario || 450)),
                indicacion_clinica: limpiarEspacios((it && it.indicacion) || (entrada && entrada.indicacion_clinica) || ''),
                modo_programacion: modoProg,
                programado_para_texto: fechaProgTxt,
                fecha_objetivo_iso: fechaObjetivoIso,
                solicitado_en: ahora.toISOString(),
                solicitado_por_id: s.usuario_id,
                solicitado_por_nombre: s.nombre,
                estatus: 'PENDIENTE_TOMA',
                confirmado_en: null,
                confirmado_por_id: null,
                confirmado_por_nombre: null,
                resultado_resumen: ''
            };
        });
        i.ordenes_estudios = (i.ordenes_estudios || []).concat(estudiosCreados);
        guardarInternamiento(i);
        return { ok: true, orden_id: ordenId, estudios: estudiosCreados, internamiento: obtenerInternamiento(i.internamiento_id) };
    }

    function confirmarEstudioEnfermeria(turnoId, itemId, datosConfirmacion, s) {
        const i = obtenerInternamiento(turnoId) || asegurarInternamiento(turnoId);
        const t = obtenerTurno((i && i.turno_id) || turnoId);
        if (!i || !t) return { ok: false, motivo: 'No se encontró el internamiento.' };
        if (!s || (!esEnfermeria(s.rol) && s.rol !== 'admin' && s.rol !== 'medico')) {
            return { ok: false, motivo: 'Solo Enfermería, el médico o Dirección pueden confirmar la realización del estudio.' };
        }
        const lista = i.ordenes_estudios || [];
        const est = lista.find(x => x.item_id === itemId || x.estudio_id === itemId);
        if (!est) return { ok: false, motivo: 'No se encontró el estudio pendiente.' };
        if (est.estatus === 'REALIZADO') return { ok: true, estudio: est, ya_confirmado: true, internamiento: i };
        const ahora = new Date().toISOString();
        est.estatus = 'REALIZADO';
        est.confirmado_en = ahora;
        est.confirmado_por_id = s.usuario_id;
        est.confirmado_por_nombre = s.nombre;
        est.resultado_resumen = limpiarEspacios((datosConfirmacion && datosConfirmacion.resultado_resumen) || 'Muestra tomada / Estudio realizado y verificado por Enfermería.');
        // Cargar automáticamente a la cuenta del paciente al confirmar Enfermería
        const precio = redondearMoneda(est.precio_unitario || 450);
        i.cargos = (i.cargos || []).concat([{
            cargo_id: uid('CG'),
            concepto: (est.categoria === 'IMAGEN' ? 'Gabinete / Imagen: ' : 'Laboratorio: ') + est.nombre,
            categoria: est.categoria === 'IMAGEN' ? 'GABINETE' : 'LABORATORIO',
            origen: 'estudio_confirmado_enfermeria',
            estudio_item_id: est.item_id,
            cantidad: 1,
            precio_unitario: precio,
            subtotal: precio,
            aplica_iva: true,
            fecha_hora: ahora,
            cargado_en: ahora,
            cargado_por_id: s.usuario_id,
            cargado_por_nombre: s.nombre
        }]);
        i.cuenta_actual = totalCargos(i.cargos);
        i.cuenta_actual_total = i.cuenta_actual;
        // También lo registramos en la Hoja de Enfermería automáticamente
        const he = obtenerHojaEnfermeria(t.turno_id);
        guardarHojaEnfermeria(t.turno_id, {
            kardex: [{ turno: 'Matutino', medicamento: '[ESTUDIO CONFIRMADO] ' + est.nombre + ' — ' + est.resultado_resumen, texto: '[ESTUDIO CONFIRMADO] ' + est.nombre }]
        }, s);
        guardarInternamiento(i);
        actualizarTurno(t.turno_id, { cuenta_actual: i.cuenta_actual, cuenta_actual_total: i.cuenta_actual });
        return { ok: true, estudio: est, internamiento: obtenerInternamiento(i.internamiento_id) };
    }

    function htmlImpresionOrdenesEstudios(turnoId) {
        const e = escHtmlCuenta;
        const t = obtenerTurno(turnoId) || {};
        const i = internamientoDeTurno(turnoId) || {};
        const p = (t.paciente_id && buscarPacientePorId(t.paciente_id)) || {};
        const nombrePac = p.nombre_completo || t.paciente_nombre || 'Paciente';
        const edadTxt = formatearEdad(p.fecha_nacimiento || t.fecha_nacimiento, calcularEdad(p.fecha_nacimiento || t.fecha_nacimiento));
        const lista = (i.ordenes_estudios || []);
        const tubos = resumenTubosEstudios(lista.map(x => x.estudio_id));
        return '<article style="font-family:Arial,sans-serif;color:#0f172a;max-width:19.5cm;margin:0 auto;font-size:11px;line-height:1.4;">'
            + '<header style="display:flex;justify-content:center;align-items:center;border-bottom:2px solid #0b3a5b;padding-bottom:8px;margin-bottom:10px;">'
            + '<div style="text-align:right;"><div style="font-size:13px;font-weight:900;color:#0b3a5b;">SOLICITUD Y CONTROL DE ESTUDIOS</div><div style="font-size:10px;color:#475569;">Expediente: <strong>' + e(t.paciente_id || 'S/N') + '</strong> · Cama: <strong>' + e(i.cama || 'Piso') + '</strong></div></div></header>'
            + '<div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;padding:8px 10px;margin-bottom:10px;display:grid;grid-template-columns:2fr 1fr 1fr;gap:6px;">'
            + '<div><strong>Paciente:</strong> ' + e(nombrePac) + '</div><div><strong>Edad:</strong> ' + e(edadTxt) + '</div><div><strong>Diagnóstico:</strong> ' + e(i.diagnostico_actual || t.dx_principal || '') + '</div></div>'
            + (tubos && tubos.recipientes && tubos.recipientes.length ? '<div style="margin-bottom:8px;background:#eff6ff;border:1px solid #93c5fd;border-radius:6px;padding:6px 10px;font-size:10.5px;"><strong>Tubos/Recipientes consolidados para toma de muestra (sin duplicar):</strong> ' + tubos.recipientes.map(r => e(r.etiqueta || r.codigo)).join(' · ') + '</div>' : '')
            + '<table style="width:100%;border-collapse:collapse;font-size:10.5px;"><thead><tr style="background:#e2e8f0;"><th style="border:1px solid #cbd5e1;padding:5px;text-align:left;">Estudio / Gabinete</th><th style="border:1px solid #cbd5e1;padding:5px;text-align:center;">Tipo</th><th style="border:1px solid #cbd5e1;padding:5px;text-align:left;">Programación</th><th style="border:1px solid #cbd5e1;padding:5px;text-align:left;">Solicitó</th><th style="border:1px solid #cbd5e1;padding:5px;text-align:center;">Estatus Enfermería</th><th style="border:1px solid #cbd5e1;padding:5px;text-align:left;">Confirmación / Hallazgos</th></tr></thead><tbody>'
            + (lista.length ? lista.map(x => '<tr><td style="border:1px solid #cbd5e1;padding:5px;"><strong>' + e(x.nombre) + '</strong>' + (x.indicacion_clinica ? '<br><span style="font-size:9.5px;color:#475569;">' + e(x.indicacion_clinica) + '</span>' : '') + '</td><td style="border:1px solid #cbd5e1;padding:5px;text-align:center;">' + e(x.categoria) + '</td><td style="border:1px solid #cbd5e1;padding:5px;font-weight:bold;">' + e(x.programado_para_texto || 'Ahora') + '</td><td style="border:1px solid #cbd5e1;padding:5px;">' + e(x.solicitado_por_nombre || '') + '</td><td style="border:1px solid #cbd5e1;padding:5px;text-align:center;font-weight:bold;color:' + (x.estatus === 'REALIZADO' ? '#047857' : '#b45309') + ';">' + (x.estatus === 'REALIZADO' ? '✓ REALIZADO Y CARGADO' : '⏳ PENDIENTE ENFERMERÍA') + '</td><td style="border:1px solid #cbd5e1;padding:5px;">' + (x.estatus === 'REALIZADO' ? e(x.confirmado_por_nombre + ' (' + fechaHoraLegible(x.confirmado_en) + ') · ' + (x.resultado_resumen || '')) : 'Pendiente de toma/confirmación') + '</td></tr>').join('') : '<tr><td colspan="6" style="border:1px solid #cbd5e1;padding:10px;text-align:center;">Sin estudios solicitados.</td></tr>')
            + '</tbody></table></article>';
    }

    // ---------------------------------------------------------------- Hoja de Enfermería Imprimible para el Portafolio Digital
    function htmlImpresionHojaEnfermeria(turnoId) {
        const e = escHtmlCuenta;
        const t = obtenerTurno(turnoId) || {};
        const i = internamientoDeTurno(turnoId) || {};
        const p = (t.paciente_id && buscarPacientePorId(t.paciente_id)) || {};
        const h = obtenerHojaEnfermeria(turnoId) || { signos: [], kardex: [], balance: { ingresos: [], egresos: [], total_ingresos: 0, total_egresos: 0, balance: 0 }, observaciones: [] };
        const nombrePac = p.nombre_completo || t.paciente_nombre || 'Paciente';
        const edadTxt = formatearEdad(p.fecha_nacimiento || t.fecha_nacimiento, calcularEdad(p.fecha_nacimiento || t.fecha_nacimiento));
        return '<article style="font-family:Arial,sans-serif;color:#0f172a;max-width:19.5cm;margin:0 auto;font-size:11px;line-height:1.38;">'
            + '<header style="display:flex;justify-content:center;align-items:center;border-bottom:2px solid #0d9488;padding-bottom:8px;margin-bottom:10px;">'
            + '<div style="text-align:right;"><div style="font-size:13px;font-weight:900;color:#0f766e;">HOJA CLÍNICA DE ENFERMERÍA</div><div style="font-size:10px;color:#475569;">Exp: <strong>' + e(t.paciente_id || 'S/N') + '</strong> · Cama: <strong>' + e(i.cama || t.cama || 'Por asignar') + '</strong></div></div></header>'
            + '<div style="background:#f0fdfa;border:1px solid #99f6e4;border-radius:6px;padding:8px 10px;margin-bottom:10px;display:grid;grid-template-columns:2fr 1fr 1fr;gap:6px;">'
            + '<div><strong>Paciente:</strong> ' + e(nombrePac) + ' (' + e(edadTxt) + ')</div><div><strong>Alergias:</strong> <span style="color:#b91c1c;font-weight:bold;">' + e(i.alergias || 'NEGADAS') + '</span></div><div><strong>Médico Tratante:</strong> ' + e(i.medico_tratante_nombre || t.medico_nombre || '') + '</div></div>'
            + '<div style="margin-bottom:10px;"><div style="font-weight:bold;font-size:10.5px;text-transform:uppercase;color:#0f766e;border-bottom:1px solid #cbd5e1;margin-bottom:4px;">1. somatometría y Signos Vitales por Turno</div>'
            + ((h.signos || []).length ? '<table style="width:100%;border-collapse:collapse;font-size:10px;"><thead><tr style="background:#f1f5f9;"><th style="border:1px solid #cbd5e1;padding:4px;">Turno</th><th style="border:1px solid #cbd5e1;padding:4px;text-align:left;">Parámetros Registrados (TA, FC, FR, Temp, SpO2, Dextrostix)</th><th style="border:1px solid #cbd5e1;padding:4px;">Enfermera(o)</th><th style="border:1px solid #cbd5e1;padding:4px;">Fecha/Hora</th></tr></thead><tbody>'
                + (h.signos || []).map(s => '<tr><td style="border:1px solid #cbd5e1;padding:4px;text-align:center;font-weight:bold;">' + e(s.turno || 'Matutino') + '</td><td style="border:1px solid #cbd5e1;padding:4px;">' + e(s.texto || s.ta || '') + (s.glucosa_mg_dl ? ' · Dxtx: ' + e(s.glucosa_mg_dl) + ' mg/dL' : '') + '</td><td style="border:1px solid #cbd5e1;padding:4px;text-align:center;">' + e(s.autor_nombre || 'Enfermería') + '</td><td style="border:1px solid #cbd5e1;padding:4px;text-align:center;">' + e(fechaHoraLegible(s.fecha_hora)) + '</td></tr>').join('') + '</tbody></table>' : '<div>Sin signos por turno adicionales registrados.</div>')
            + '</div>'
            + '<div style="margin-bottom:10px;"><div style="font-weight:bold;font-size:10.5px;text-transform:uppercase;color:#0f766e;border-bottom:1px solid #cbd5e1;margin-bottom:4px;">2. Kardex de Medicamentos Administrados y Procedimientos</div>'
            + ((h.kardex || []).length ? '<table style="width:100%;border-collapse:collapse;font-size:10px;"><thead><tr style="background:#f1f5f9;"><th style="border:1px solid #cbd5e1;padding:4px;">Turno</th><th style="border:1px solid #cbd5e1;padding:4px;text-align:left;">Medicamento / Indicación Administrada</th><th style="border:1px solid #cbd5e1;padding:4px;">Administró</th><th style="border:1px solid #cbd5e1;padding:4px;">Fecha/Hora</th></tr></thead><tbody>'
                + (h.kardex || []).map(k => '<tr><td style="border:1px solid #cbd5e1;padding:4px;text-align:center;font-weight:bold;">' + e(k.turno || 'Matutino') + '</td><td style="border:1px solid #cbd5e1;padding:4px;">' + e(k.medicamento || k.texto || '') + '</td><td style="border:1px solid #cbd5e1;padding:4px;text-align:center;">' + e(k.autor_nombre || 'Enfermería') + '</td><td style="border:1px solid #cbd5e1;padding:4px;text-align:center;">' + e(fechaHoraLegible(k.fecha_hora)) + '</td></tr>').join('') + '</tbody></table>' : '<div>Sin medicamentos en kardex.</div>')
            + '</div>'
            + '<div style="margin-bottom:10px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;padding:6px 10px;">'
            + '<div><strong>Total Ingresos Hídricos:</strong> ' + e(h.balance && h.balance.total_ingresos || 0) + ' ml</div>'
            + '<div><strong>Total Egresos (Uresis/Evac):</strong> ' + e(h.balance && h.balance.total_egresos || 0) + ' ml</div>'
            + '<div><strong>Balance Hídrico Total:</strong> <strong>' + e(h.balance && h.balance.balance || 0) + ' ml</strong></div></div>'
            + '<div style="margin-bottom:10px;"><div style="font-weight:bold;font-size:10.5px;text-transform:uppercase;color:#0f766e;border-bottom:1px solid #cbd5e1;margin-bottom:4px;">3. Notas y Observaciones de Enfermería</div>'
            + ((h.observaciones || []).length ? '<ul style="margin:0;padding-left:16px;">' + (h.observaciones || []).map(o => '<li>' + e(typeof o === 'string' ? o : (o.texto || '')) + '</li>').join('') + '</ul>' : '<div>Paciente consciente, orientado, catéter venoso periférico permeable sin datos de flebitis.</div>')
            + '</div></article>';
    }

    // ---------------------------------------------------------------- Alta por Servicio (Pre-Alta Quirúrgica / Especialidad) para Manejo Conjunto
    function registrarAltaPorServicio(internamientoId, entrada, s) {
        const i = obtenerInternamiento(internamientoId) || resolverInternamiento(internamientoId);
        if (!i || !s) return { ok: false, motivo: 'No se encontró el internamiento.' };
        if (s.rol !== 'medico' && s.rol !== 'admin') return { ok: false, motivo: 'Solo el médico especialista puede otorgar el alta de su servicio.' };
        const u = USUARIOS[s.usuario_id] || {};
        const espNombre = especialidadImpresaMedico(u) || u.cargo || s.especialidad || 'Especialidad';
        const resumen = limpiarEspacios((entrada && entrada.resumen_servicio) || 'Por parte de nuestro servicio se otorga pre-alta / alta de especialidad; paciente en condiciones de continuar manejo y egreso definitivo por médico coordinador.');
        const indicaciones = expandirAbreviaturasMedicas(limpiarEspacios((entrada && entrada.indicaciones_alta_servicio) || 'Continuar vigilancia de herida quirúrgica y cita abierta a urgencias.'));
        const registro = {
            alta_servicio_id: uid('ASV'),
            fecha_hora: new Date().toISOString(),
            medico_id: s.usuario_id,
            medico_nombre: u.nombre || s.nombre,
            especialidad: espNombre,
            cedulas_impresas: textoCedulasFirma(u) || '',
            resumen_servicio: resumen,
            indicaciones_alta_servicio: indicaciones
        };
        i.altas_por_servicio = (i.altas_por_servicio || []).concat([registro]);
        // También agrega una Nota de Evolución automática dejando constancia legal del Alta por Servicio
        i.notas_evolucion = (i.notas_evolucion || []).concat([{
            nota_id: uid('EV'),
            folio: 'EV-' + String((i.notas_evolucion || []).length + 1).padStart(3, '0'),
            tipo: 'nota_evolucion',
            formato: 'SOAP',
            fecha_hora: registro.fecha_hora,
            autor_id: s.usuario_id,
            autor_nombre: u.nombre || s.nombre,
            autor_especialidad: espNombre,
            relacion: esCirujanoDelInternamiento(i, s) ? 'cirujano' : 'interconsultante',
            subjetivo: 'Valoración para alta por el servicio de ' + espNombre + '. Paciente asintomático desde el punto de vista de la especialidad.',
            objetivo: 'Estable hemodinámicamente, evolución favorable post-procedimiento.',
            analisis: '[ALTA POR SERVICIO DE ' + espNombre.toUpperCase() + '] ' + resumen,
            plan: indicaciones,
            pronostico: 'Bueno para la vida y la función'
        }]);
        guardarInternamiento(i);
        return { ok: true, alta_servicio: registro, internamiento: obtenerInternamiento(i.internamiento_id) };
    }

    // ---------------------------------------------------------------- Hoja de Egreso Voluntario Blindada Médico-Legalmente (18_EGRESO_VOLUNTARIO.docx + NOM-004 + Art. 79 RLGSPSAM)
    function prefillAltaVoluntaria(turnoId) {
        const t = obtenerTurno(turnoId) || {};
        const i = internamientoDeTurno(turnoId) || {};
        const p = (t.paciente_id && buscarPacientePorId(t.paciente_id)) || {};
        const snap = (i.captura_inicial && i.captura_inicial.campos) || {};
        const fn = p.fecha_nacimiento || t.fecha_nacimiento || '';
        const edad = fn ? calcularEdad(fn) : '';
        const sv = i.signos_vitales || t.signos_vitales || {};
        const u = (i.medico_tratante_id && USUARIOS[i.medico_tratante_id]) || (t.medico_id && USUARIOS[t.medico_id]) || {};
        return {
            turno_id: t.turno_id || turnoId,
            internamiento_id: i.internamiento_id || '',
            expediente: t.paciente_id || p.paciente_id || 'S/N',
            paciente_nombre: p.nombre_completo || t.paciente_nombre || '',
            edad: formatearEdad(fn, edad) || (edad ? edad + ' años' : ''),
            sexo: (p.sexo || t.sexo) === 'F' ? 'Femenino' : 'Masculino',
            domicilio: p.direccion || snap['comp-dir'] || 'Conocido en Puerto Vallarta, Jalisco',
            telefono: p.telefono || snap['comp-tel'] || '3220000000',
            ocupacion: p.ocupacion || snap['comp-ocupacion'] || 'Empleado(a)',
            servicio_cama: (i.area_destino || 'Observación') + ' · ' + (i.cama || t.cama || 'OBS-1'),
            diagnostico_ingreso: i.diagnostico_actual || i.diagnostico_ingreso || t.dx_principal || t.motivo || '',
            medico_nombre: i.medico_tratante_nombre || t.medico_nombre || u.nombre || 'Dr. Juan Pérez',
            medico_cedulas: textoCedulasFirma(u) || u.cedula_profesional || 'MG-11021',
            solicitante_nombre: snap['val-responsable'] || p.nombre_completo || t.paciente_nombre || '',
            solicitante_parentesco: snap['val-parentesco'] || 'Mismo paciente / Familiar responsable',
            motivo_egreso_voluntario: 'Decisión personal y económica del paciente y/o familiar responsable de no continuar con el internamiento hospitalario indicado, pese a haber sido informado ampliamente de los riesgos médicos.',
            riesgos_explicados: 'Complicación aguda del padecimiento actual, descompensación hemodinámica, neurológica o metabólica, progresión de la enfermedad, secuelas funcionales permanentes e incluso riesgo de muerte fuera de vigilancia médica hospitalaria.',
            medidas_recomendadas: 'Acudir de inmediato a un servicio de Urgencias Hospitalarias en caso de dolor intenso, disnea, alteración del estado de conciencia, fiebre, sangrado o deterioro clínico; continuar vigilancia médica estrecha.',
            signos_egreso: {
                ta: (sv.ta_sistolica && sv.ta_diastolica) ? (sv.ta_sistolica + '/' + sv.ta_diastolica + ' mmHg') : '130/85 mmHg',
                fc: (sv.fc || sv.frecuencia_cardiaca || 82) + ' lpm',
                fr: (sv.fr || sv.frecuencia_respiratoria || 18) + ' rpm',
                temp: (sv.temp || sv.temperatura_c || 36.8) + ' °C',
                spo2: (sv.spo2 || sv.spo2_porcentaje || 97) + '%',
                glasgow: '15/15 (Consciente, orientado y en pleno uso de sus facultades mentales)'
            },
            testigo_1_nombre: 'C. Testigo Familiar / Acompañante',
            testigo_1_domicilio: 'Puerto Vallarta, Jalisco',
            testigo_2_nombre: 'Enf. Lupita (Personal de Enfermería Sanatorio Belén)',
            testigo_2_domicilio: 'Josefa Ortiz de Domínguez #189, Col. Pitillal Centro, Puerto Vallarta, Jal.'
        };
    }

    function registrarAltaVoluntaria(turnoId, entrada, s) {
        const i = obtenerInternamiento(turnoId) || asegurarInternamiento(turnoId);
        const t = obtenerTurno((i && i.turno_id) || turnoId);
        if (!i || !t) return { ok: false, motivo: 'No se encontró el episodio clínico.' };
        const pre = prefillAltaVoluntaria(t.turno_id);
        const datos = Object.assign({}, pre, entrada || {}, {
            folio: 'EGV-001',
            fecha_hora: new Date().toISOString(),
            registrado_por_id: (s && s.usuario_id) || 'dr_juan',
            registrado_por_nombre: (s && s.nombre) || pre.medico_nombre
        });
        // Si el paciente estaba en Observación y se había preparado papelería para Hospitalización pero pidió Alta Voluntaria antes de subir a piso,
        // eliminamos cualquier cargo de cama de Hospitalización para que solo pague Consulta + Observación + medicamentos aplicados:
        const cancelarSubidaPiso = !!(entrada && entrada.cancelo_pase_hospitalizacion) || i.area_codigo === 'OBSERVACION';
        if (cancelarSubidaPiso) {
            i.cargos = (i.cargos || []).filter(c => !/habitaci[oó]n|hospitalizaci[oó]n/i.test(c.concepto || ''));
            t.cargos = (t.cargos || []).filter(c => !/habitaci[oó]n|hospitalizaci[oó]n/i.test(c.concepto || ''));
            i.area_codigo = 'OBSERVACION';
            i.area_destino = 'Observación (Alta Voluntaria antes de pasar a Hospitalización)';
        }
        i.alta_voluntaria = datos;
        i.nota_egreso = {
            nota_id: uid('EGV'),
            folio: 'EGV-001',
            tipo: 'alta_voluntaria',
            es_alta_voluntaria: true,
            fecha_hora: datos.fecha_hora,
            autor_id: datos.registrado_por_id,
            autor_nombre: datos.medico_nombre,
            motivo_egreso: 'Alta Voluntaria solicitada por el paciente/familiar en contra de indicación médica',
            diagnostico_ingreso: datos.diagnostico_ingreso,
            diagnostico_final: datos.diagnostico_ingreso + ' (Egreso Voluntario contra indicación médica)',
            resumen_evolucion: 'Paciente que ingresó a ' + datos.servicio_cama + '. Se indicó manejo intrahospitalario; sin embargo, el paciente y su familiar responsable solicitan egreso voluntario asumiendo los riesgos explicados y firmando la Hoja de Egreso Voluntario y Responsiva Médico-Legal conforme a la NOM-004-SSA3-2012 (numeral 10.2) y Art. 79 del RLGSPSAM.',
            manejo_hospitalario: 'Valoración médica, vigilancia en observación y administración de medicamentos iniciales.',
            problemas_pendientes: datos.riesgos_explicados,
            plan_alta: datos.medidas_recomendadas,
            pronostico: 'Reservado por retiro voluntario contra indicación médica'
        };
        i.estatus = ESTATUS.ALTA_PENDIENTE_PAGO;
        i.egreso_en = datos.fecha_hora;
        i.cuenta_actual = totalCargos(cargosDeEpisodio(t));
        i.cuenta_actual_total = i.cuenta_actual;
        guardarInternamiento(i);
        actualizarTurno(t.turno_id, {
            estatus: ESTATUS.ALTA_PENDIENTE_PAGO,
            cuenta_actual: i.cuenta_actual,
            cuenta_actual_total: i.cuenta_actual
        });
        return { ok: true, alta_voluntaria: datos, internamiento: obtenerInternamiento(i.internamiento_id) };
    }

    function htmlImpresionCartaAltaVoluntaria(datos, turnoId) {
        const e = escHtmlCuenta;
        const d = Object.assign({}, prefillAltaVoluntaria(turnoId), datos || {});
        const sv = d.signos_egreso || {};
        return '<article style="font-family:Arial,sans-serif;color:#0f172a;max-width:19.5cm;margin:0 auto;font-size:10.5px;line-height:1.36;page-break-inside:avoid;">'
            + '<header style="display:flex;justify-content:center;align-items:center;border-bottom:2px solid #991b1b;padding-bottom:6px;margin-bottom:8px;">'
            + '<div style="text-align:right;"><div style="font-size:12.5px;font-weight:900;color:#991b1b;text-transform:uppercase;">HOJA DE EGRESO VOLUNTARIO Y RESPONSIVA MÉDICO-LEGAL</div><div style="font-size:9.5px;color:#475569;">NOM-004-SSA3-2012 (Num. 10.2) · Art. 79 RLGSPSAM · Folio: <strong>' + e(d.folio || 'EGV-001') + '</strong></div></div></header>'
            + '<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;padding:7px 9px;margin-bottom:8px;display:grid;grid-template-columns:2fr 1fr 1fr;gap:5px;">'
            + '<div><strong>Nombre del Paciente:</strong> ' + e(d.paciente_nombre) + '</div><div><strong>Edad / Sexo:</strong> ' + e(d.edad) + ' · ' + e(d.sexo) + '</div><div><strong>No. Expediente:</strong> ' + e(d.expediente) + '</div>'
            + '<div><strong>Domicilio:</strong> ' + e(d.domicilio) + '</div><div><strong>Teléfono:</strong> ' + e(d.telefono) + '</div><div><strong>Área / Cama:</strong> ' + e(d.servicio_cama) + '</div>'
            + '<div style="grid-column:span 2;"><strong>Diagnóstico Médico Actual:</strong> ' + e(d.diagnostico_ingreso) + '</div><div><strong>Fecha y Hora:</strong> ' + e(fechaHoraLegible(d.fecha_hora || new Date().toISOString())) + '</div></div>'
            + '<div style="border:1px solid #94a3b8;border-radius:5px;padding:7px 9px;margin-bottom:8px;text-align:justify;">'
            + '<strong>1. DECLARATORIA EXPRESA DE SOLICITUD DE ALTA VOLUNTARIA Y EXONERACIÓN DE RESPONSABILIDAD CIVIL, PENAL Y ADMINISTRATIVA:</strong><br>'
            + 'En Puerto Vallarta, Jalisco, quien suscribe <strong>' + e(d.solicitante_nombre) + '</strong> (en calidad de <strong>' + e(d.solicitante_parentesco) + '</strong>), en pleno uso de mis facultades mentales, libre de toda coacción física o moral, por mi propio derecho solicito a <strong>SANATORIO BELÉN S.A. DE C.V.</strong> y al Médico Tratante <strong>' + e(d.medico_nombre) + ' (' + e(d.medico_cedulas) + ')</strong> el <strong>EGRESO VOLUNTARIO INMEDIATO</strong> del paciente arriba citado, <strong>EN CONTRA DE LA INDICACIÓN MÉDICA EXPRESA</strong> de permanecer internado bajo vigilancia y tratamiento hospitalario.<br>'
            + 'Hago constar que el Médico Tratante y el personal de Sanatorio Belén <strong>NO negaron la atención médica en ningún momento</strong>, sino que me explicaron de forma clara, verbal y por escrito la gravedad del padecimiento y la necesidad de continuar el manejo hospitalario. Por lo anterior, <strong>libero y eximo de toda responsabilidad médica, legal, civil, penal o administrativa</strong> a <strong>SANATORIO BELÉN S.A. DE C.V.</strong>, a su cuerpo médico, personal de enfermería y directivos por cualquier deterioro, complicación, secuela o fallecimiento derivado de interrumpir la atención hospitalaria.'
            + '</div>'
            + '<div style="margin-bottom:7px;"><strong>2. Motivo expresado por el paciente/familiar para el retiro voluntario:</strong><div style="border:1px solid #cbd5e1;border-radius:4px;padding:4px 7px;background:#f8fafc;">' + e(d.motivo_egreso_voluntario) + '</div></div>'
            + '<div style="margin-bottom:7px;"><strong>3. Estado clínico y Signos Vitales verificados al momento de retirarse del hospital:</strong><div style="border:1px solid #cbd5e1;border-radius:4px;padding:4px 7px;background:#f8fafc;">TA: <strong>' + e(sv.ta || '130/85 mmHg') + '</strong> · FC: <strong>' + e(sv.fc || '82 lpm') + '</strong> · FR: <strong>' + e(sv.fr || '18 rpm') + '</strong> · Temp: <strong>' + e(sv.temp || '36.8 °C') + '</strong> · SpO2: <strong>' + e(sv.spo2 || '97%') + '</strong> · Estado neurológico: <strong>' + e(sv.glasgow || 'Glasgow 15/15, consciente y orientado') + '</strong></div></div>'
            + '<div style="margin-bottom:7px;"><strong>4. Resumen de Riesgos Médicos Específicos advertidos en caso de egreso voluntario (NOM-004 num. 10.2.4):</strong><div style="border:1px solid #fca5a5;border-radius:4px;padding:4px 7px;background:#fff1f2;color:#881337;">' + e(d.riesgos_explicados) + '</div></div>'
            + '<div style="margin-bottom:10px;"><strong>5. Medidas recomendadas y Signos de Alarma explicados para acudir de inmediato a Urgencias (NOM-004 num. 10.2.5):</strong><div style="border:1px solid #cbd5e1;border-radius:4px;padding:4px 7px;background:#f8fafc;">' + e(d.medidas_recomendadas) + '</div></div>'
            + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:16px;text-align:center;font-size:9.5px;">'
            + '<div style="border-top:1px solid #0f172a;padding-top:4px;"><strong>' + e(d.solicitante_nombre) + '</strong><br>Nombre y Firma del Paciente o Familiar que solicita el Egreso Voluntario<br>Parentesco: ' + e(d.solicitante_parentesco) + ' · Tel: ' + e(d.telefono) + '</div>'
            + '<div style="border-top:1px solid #0f172a;padding-top:4px;"><strong>' + e(d.medico_nombre) + '</strong><br>' + e(d.medico_cedulas) + '<br>Médico que informó riesgos y emite la Hoja de Egreso Voluntario</div>'
            + '<div style="border-top:1px solid #0f172a;padding-top:4px;margin-top:14px;"><strong>' + e(d.testigo_1_nombre) + '</strong><br>Nombre, Domicilio y Firma del Testigo 1 (Art. 79 RLGSPSAM)<br>' + e(d.testigo_1_domicilio) + '</div>'
            + '<div style="border-top:1px solid #0f172a;padding-top:4px;margin-top:14px;"><strong>' + e(d.testigo_2_nombre) + '</strong><br>Nombre, Domicilio y Firma del Testigo 2 (Personal de la Institución)<br>' + e(d.testigo_2_domicilio) + '</div>'
            + '</div></article>';
    }

    // ---------------------------------------------------------------- Completar Nota de Ingreso e Historia Clínica cuando la paciente entró directo a Parto/Quirófano sin consulta previa
    function guardarNotaIngresoDirectoHospital(turnoId, entrada, s) {
        const i = obtenerInternamiento(turnoId) || asegurarInternamiento(turnoId);
        const t = obtenerTurno((i && i.turno_id) || turnoId);
        if (!i || !t) return { ok: false, motivo: 'No se encontró el internamiento.' };
        if (!s || (s.rol !== 'medico' && s.rol !== 'admin')) return { ok: false, motivo: 'Solo el médico puede elaborar la Nota de Ingreso e Historia Clínica.' };
        const ahora = new Date().toISOString();
        const u = USUARIOS[s.usuario_id] || {};
        const datos = {
            folio: 'NI-DIR-001',
            fecha_hora: ahora,
            autor_id: s.usuario_id,
            autor_nombre: u.nombre || s.nombre,
            autor_especialidad: especialidadImpresaMedico(u) || u.cargo || '',
            cedulas_impresas: textoCedulasFirma(u) || '',
            motivo_ingreso: limpiarEspacios(entrada.motivo_ingreso || t.motivo || 'Ingreso directo para atención obstétrica / quirúrgica'),
            padecimiento_actual: limpiarEspacios(entrada.padecimiento_actual || ''),
            antecedentes_heredofamiliares: limpiarEspacios(entrada.antecedentes_heredofamiliares || 'Interrogados y negados de relevancia.'),
            antecedentes_personales_no_patologicos: limpiarEspacios(entrada.antecedentes_personales_no_patologicos || 'Habitación con todos los servicios, toxicomanías negadas.'),
            antecedentes_personales_patologicos: limpiarEspacios(entrada.antecedentes_personales_patologicos || 'Crónico-degenerativos, quirúrgicos y transfusionales interrogados.'),
            antecedentes_gineco_obstetricos: limpiarEspacios(entrada.antecedentes_gineco_obstetricos || ''),
            exploracion_fisica: limpiarEspacios(entrada.exploracion_fisica || ''),
            diagnostico_ingreso: limpiarEspacios(entrada.diagnostico_ingreso || i.diagnostico_actual || t.dx_principal || ''),
            plan_manejo: expandirAbreviaturasMedicas(limpiarEspacios(entrada.plan_manejo || '')),
            pronostico: limpiarEspacios(entrada.pronostico || 'Bueno para la vida y la función')
        };
        i.nota_ingreso_directo = datos;
        i.sin_nota_consulta = false;
        if (datos.diagnostico_ingreso) i.diagnostico_actual = datos.diagnostico_ingreso;
        guardarInternamiento(i);
        return { ok: true, nota_ingreso_directo: datos, internamiento: obtenerInternamiento(i.internamiento_id) };
    }

    function htmlImpresionNotaIngresoDirecto(datos, turnoId) {
        const e = escHtmlCuenta;
        const t = obtenerTurno(turnoId) || {};
        const i = internamientoDeTurno(turnoId) || {};
        const p = (t.paciente_id && buscarPacientePorId(t.paciente_id)) || {};
        const d = datos || i.nota_ingreso_directo || {};
        const nombrePac = p.nombre_completo || t.paciente_nombre || 'Paciente';
        const edadTxt = formatearEdad(p.fecha_nacimiento || t.fecha_nacimiento, calcularEdad(p.fecha_nacimiento || t.fecha_nacimiento));
        const sv = i.signos_vitales || t.signos_vitales || {};
        return '<article style="font-family:Arial,sans-serif;color:#0f172a;max-width:19.5cm;margin:0 auto;font-size:11px;line-height:1.38;">'
            + '<header style="display:flex;justify-content:center;align-items:center;border-bottom:2px solid #0b3a5b;padding-bottom:8px;margin-bottom:10px;">'
            + '<div style="text-align:right;"><div style="font-size:13px;font-weight:900;color:#0b3a5b;">NOTA DE INGRESO E HISTORIA CLÍNICA</div><div style="font-size:10px;color:#475569;">Exp: <strong>' + e(t.paciente_id || 'S/N') + '</strong> · Cama: <strong>' + e(i.cama || 'Piso') + '</strong></div></div></header>'
            + '<div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;padding:8px 10px;margin-bottom:10px;display:grid;grid-template-columns:2fr 1fr 1fr;gap:6px;">'
            + '<div><strong>Paciente:</strong> ' + e(nombrePac) + ' (' + e(edadTxt) + ')</div><div><strong>Alergias:</strong> <span style="color:#b91c1c;font-weight:bold;">' + e(i.alergias || 'NEGADAS') + '</span></div><div><strong>Fecha/Hora:</strong> ' + e(fechaHoraLegible(d.fecha_hora || i.fecha_ingreso)) + '</div>'
            + '<div style="grid-column:span 3;"><strong>Signos Vitales al Ingreso:</strong> TA ' + e((sv.ta_sistolica || 115) + '/' + (sv.ta_diastolica || 75)) + ' mmHg · FC ' + e(sv.fc || sv.frecuencia_cardiaca || 80) + ' lpm · FR ' + e(sv.fr || sv.frecuencia_respiratoria || 18) + ' rpm · Temp ' + e(sv.temp || sv.temperatura_c || 36.6) + ' °C · SpO2 ' + e(sv.spo2 || sv.spo2_porcentaje || 98) + '%</div></div>'
            + '<div style="margin-bottom:8px;"><strong>1. Motivo de Ingreso y Padecimiento Actual:</strong><div style="white-space:pre-wrap;border:1px solid #cbd5e1;border-radius:5px;padding:6px 8px;margin-top:2px;">' + e((d.motivo_ingreso ? d.motivo_ingreso + '\n' : '') + (d.padecimiento_actual || '')) + '</div></div>'
            + '<div style="margin-bottom:8px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">'
            + '<div style="border:1px solid #cbd5e1;border-radius:5px;padding:6px 8px;"><strong>2. Antecedentes Heredofamiliares y No Patológicos:</strong><br>' + e(d.antecedentes_heredofamiliares) + '<br>' + e(d.antecedentes_personales_no_patologicos) + '</div>'
            + '<div style="border:1px solid #cbd5e1;border-radius:5px;padding:6px 8px;"><strong>3. Antecedentes Personales Patológicos y Gineco-Obstétricos:</strong><br>' + e(d.antecedentes_personales_patologicos) + (d.antecedentes_gineco_obstetricos ? '<br><strong>AGO:</strong> ' + e(d.antecedentes_gineco_obstetricos) : '') + '</div></div>'
            + '<div style="margin-bottom:8px;"><strong>4. Exploración Física Completa / Obstétrica:</strong><div style="white-space:pre-wrap;border:1px solid #cbd5e1;border-radius:5px;padding:6px 8px;margin-top:2px;">' + e(d.exploracion_fisica || '') + '</div></div>'
            + '<div style="margin-bottom:8px;"><strong>5. Impresión Diagnóstica de Ingreso:</strong><div style="font-weight:bold;border:1px solid #cbd5e1;border-radius:5px;padding:6px 8px;margin-top:2px;">' + e(d.diagnostico_ingreso || '') + '</div></div>'
            + '<div style="margin-bottom:14px;"><strong>6. Plan de Manejo y Pronóstico:</strong><div style="white-space:pre-wrap;border:1px solid #cbd5e1;border-radius:5px;padding:6px 8px;margin-top:2px;">' + e(d.plan_manejo || '') + '<br><strong>Pronóstico:</strong> ' + e(d.pronostico || '') + '</div></div>'
            + '<footer style="margin-top:20px;text-align:center;"><div style="display:inline-block;min-width:260px;border-top:1px solid #0f172a;padding-top:4px;"><strong>' + e(d.autor_nombre || i.medico_tratante_nombre || '') + '</strong><br>' + e(d.autor_especialidad || '') + '<br>' + e(d.cedulas_impresas || '').replace(/\n/g, '<br>') + '</div></footer></article>';
    }


    // ============================================================
    // CACHÉ DE AVANCES, BITÁCORA Y 4 CASOS CLÍNICOS SINCRONIZADOS ENTRE COMPUTADORAS
    // ============================================================
    const BITACORA_CACHE_AVANCES = [
        {
            bloque: 'Escenario 1 · Consulta Externa + Aplicación de 2 Medicamentos en 1 Jeringa + Pre-cobro en Caja',
            fecha: '28 Oct 2026',
            paciente_demo: 'Carlos Alberto Mendoza Ruiz (Turno T-CACHE-1)',
            puntos: [
                'Recepción registra paciente con verificación de identidad y Triage captura signos vitales completos.',
                'Médico General (Dr. Juan Pérez) emite Receta a Casa y Orden de Aplicación en Clínica con 2 medicamentos (Ketorolaco 30 mg + Dexametasona 8 mg IM) indicando aplicar ambos en una misma jeringa.',
                'Enfermería aplica los 2 medicamentos y registra en la cuenta del paciente únicamente 1 jeringa con aguja + los 2 ámpulas (PERMISOS.cargar_cuenta_consulta habilitado para Enfermería).',
                'Si el paciente paga anticipadamente en Caja antes de que el médico cierre la nota, al dar Alta el turno pasa directo a cerrado_historico sin duplicar cobro en Caja.'
            ]
        },
        {
            bloque: 'Escenario 2 · Hospitalización de 5 Días: Observación sin Papelería Qx -> Interconsulta -> Estudios/TAC -> Cirugía con Alfonso -> Pre-Alta y Alta',
            fecha: '28 Oct 2026',
            paciente_demo: 'María Elena Gómez Valdez (Turno T-CACHE-2 · Cama HOSP-3)',
            puntos: [
                'Día 1 (Observación Médica): Ingresa a Observación por cefalea refractaria. El sistema genera SOLO Consentimiento General de Ingreso y Contrato de Prestación de Servicios (sin papelería quirúrgica ni anestésica).',
                'Día 1-2 (Hoja de Enfermería e Interconsulta): Enfermería llena Hoja Clínica de Enfermería (signos por turno, líquidos y medicamentos). Médico General solicita interconsulta a Medicina Interna (Dr. Alejandro Morales) y el internista responde con nota formal firmada.',
                'Día 2-3 (Pase a Hospitalización + TAC y Laboratorios): Pasa a cama HOSP-3 sin papelería quirúrgica. Medicina Interna solicita Tomografía de Cráneo Simple (TAC), BH y QS; Enfermería confirma la toma/realización desde su panel y el cargo se suma automáticamente a la cuenta.',
                'Día 3-4 (Programación Quirúrgica + Equipo de Alfonso + Valoración Preoperatoria): Interconsulta a Angiología (Dr. Roberto Navarro), quien programa safenectomía + fleboextracción. Alfonso (Administración) confirma la cirugía asignando 1er Ayudante (Dr. Marco Antonio Vega), Instrumentista (Lic. Enf. Sofía Ríos), Circulante (Enf. Carmen López) y Anestesióloga (Dra. Elena Vázquez).',
                'Día 4-5 (Hoja Quirúrgica Pre-llenada + Pre-Alta por Servicio + Alta Definitiva): Al abrir la Hoja Quirúrgica desde el expediente del angiólogo, el sistema pre-llena automáticamente todo el equipo confirmado por Alfonso. Posteriormente emite Pre-Alta por servicio y Alta Hospitalaria definitiva.'
            ]
        },
        {
            bloque: 'Escenario 3 · Embarazada que Ingresa Directo a Parto (Sin pasar por Consulta Externa)',
            fecha: '28 Oct 2026',
            paciente_demo: 'Valeria Sofía Hernández Luna (Turno T-CACHE-3 · Cama REC-GINECO)',
            puntos: [
                'Ingreso directo a Hospitalización / Gineco-Obstetricia por trabajo de parto activo (39.4 SDG) con la Dra. Patricia Solís (sin pasar por consulta externa).',
                'Se habilita la Nota de Ingreso e Historia Clínica Directa en Hospitalización para pacientes sin consulta previa.',
                'Registro e impresión de Nota de Atención de Parto Eutócico y Alumbramiento (NOM-007-SSA2-2016) con sangrado estimado, placenta, episiorrafia y Apgar.',
                'Registro e impresión de Hoja de Recién Nacido por Pediatría (Dr. Carlos Méndez) con somatometría, Apgar 9/9, Silverman 0, profilaxis oftálmica y vitamina K (sin Tamiz).'
            ]
        },
        {
            bloque: 'Escenario 4 · Paciente en Observación que Solicita Alta Voluntaria (Exoneración Legal NOM-004)',
            fecha: '28 Oct 2026',
            paciente_demo: 'Jorge Luis Navarro Pineda (Turno T-CACHE-4 · Observación OBS-2)',
            puntos: [
                'Paciente en Observación por dolor abdominal en estudio que decide retirarse en contra de la recomendación médica.',
                'Botón de Alta Voluntaria pre-llena automáticamente nombre, edad, cama, diagnóstico de ingreso, médico tratante y fecha/hora.',
                'Genera e imprime la Hoja de Egreso Voluntario y Responsiva Médico-Legal basada en el documento oficial 18_EGRESO_VOLUNTARIO.docx de Google Drive, blindada con NOM-004-SSA3-2012 (numeral 10.2) y Art. 79 del RLGSPSAM, deslindando a Sanatorio Belén y al personal médico de toda responsabilidad civil, penal o administrativa, con firmas de solicitante y 2 testigos.',
                'Al egresar desde Observación, elimina cargos de habitación de hospitalización y envía a Caja únicamente lo consumido en Observación.'
            ]
        }
    ];

    function sesionParaCache(userId) {
        const u = USUARIOS[userId] || {};
        return {
            rol: u.rol || 'medico',
            id: u.id || userId,
            usuario_id: u.id || userId,
            nombre: u.nombre || userId,
            cargo: u.cargo || '',
            medico_id: u.medico_id || u.id || userId,
            medico_nombre: u.nombre || userId,
            especialidad: u.cargo || '',
            especialidad_codigo: u.especialidad_codigo || ''
        };
    }


    function sembrarAgendaQuirurgica20Dias(forzar) {
        try {
            if (!forzar && localStorage.getItem('belen_qx_20dias_v21') === '1' && listarCirugias().length >= 35) return;
            const ses = sesionParaCache('admin');
            const nombres = ['ALEJANDRO','FERNANDA','EDUARDO','GABRIELA','RODRIGO','DANIELA','MAURICIO','PAOLA','HECTOR','LUCIA','SERGIO','CAMILA','GUSTAVO','MARIANA','OSCAR','VERONICA','ARTURO','NATALIA','RUBEN','KARLA'];
            const paternos = ['MORALES','ORTEGA','DELGADO','SILVA','MENDOZA','ROJAS','GUERRERO','AGUILAR','CASTRO','CAMPOS','VARGAS','RIOS','REYES','CRUZ','MEJIA','FLORES','VEGA','LUNA','PINEDA','SANTOS'];
            const maternos = ['SALAZAR','PONCE','IBARRA','TREJO','NAVARRO','MOLINA','CORTES','JUAREZ','ACOSTA','SOLIS'];
            const procs = [
                { p: 'Colecistectomía laparoscópica', m: 'dr_arturo', d: 90, e: 'HOSPITALARIA' },
                { p: 'Cesárea segmentaria tipo Kerr', m: 'dra_patricia', d: 90, e: 'HOSPITALARIA', ped: 'dr_carlos_ped', s: 'F' },
                { p: 'Safenectomía y flebectomía bilateral', m: 'dr_roberto', d: 90, e: 'AMBULATORIA' },
                { p: 'Plastía inguinal con malla sin tensión', m: 'dr_arturo', d: 60, e: 'AMBULATORIA' },
                { p: 'Histerectomía total abdominal', m: 'dra_patricia', d: 120, e: 'HOSPITALARIA', s: 'F' },
                { p: 'Apendicectomía laparoscópica programada', m: 'dr_arturo', d: 60, e: 'HOSPITALARIA' },
                { p: 'Fístula arteriovenosa radiocefálica', m: 'dr_roberto', d: 60, e: 'AMBULATORIA' },
                { p: 'Oclusión tubaria bilateral (OTB)', m: 'dra_patricia', d: 60, e: 'AMBULATORIA', s: 'F' }
            ];
            const base = new Date();
            for (let dia = 1; dia <= 20; dia++) {
                const dt = new Date(base.getFullYear(), base.getMonth(), base.getDate() + dia);
                const fecha = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
                for (let turno = 0; turno < 2; turno++) {
                    const idx = (dia - 1) * 2 + turno;
                    const pr = procs[idx % procs.length];
                    const nom = (pr.s === 'F' ? ['FERNANDA','GABRIELA','DANIELA','PAOLA','LUCIA','CAMILA','MARIANA','VERONICA','NATALIA','KARLA'][idx % 10] : nombres[idx % nombres.length]);
                    const pat = paternos[idx % paternos.length];
                    const mat = maternos[(idx * 3 + dia) % maternos.length];
                    programarCirugia({
                        nombres: nom, apellido_paterno: pat, apellido_materno: mat,
                        nombre: nom + ' ' + pat + ' ' + mat,
                        fecha_nacimiento: (1965 + (idx % 34)) + '-0' + ((idx % 9) + 1) + '-' + String(10 + (idx % 18)),
                        sexo: pr.s || (idx % 2 ? 'M' : 'F'),
                        telefono: '3221' + String(100000 + idx * 137).slice(0, 6),
                        direccion: 'Puerto Vallarta, Jalisco',
                        tipo_estancia: pr.e, procedimiento: pr.p,
                        sala: SALAS_QUIROFANO[turno % SALAS_QUIROFANO.length].codigo,
                        fecha: fecha, hora_inicio: turno === 0 ? '09:00' : '13:00', duracion_minutos: pr.d,
                        medico_cirujano_id: pr.m, anestesiologo_id: 'dra_elena',
                        pediatra_id: pr.ped || null, requiere_pediatra: !!pr.ped,
                        indicaciones_preoperatorias: 'Ayuno de 8 horas, laboratorios preoperatorios vigentes y canalización con solución Hartmann.'
                    }, ses);
                }
            }
            localStorage.setItem('belen_qx_20dias_v21', '1');
        } catch (e) { console.warn('sembrarAgendaQuirurgica20Dias:', e); }
    }

    function obtenerIdsCacheRecorrido() {
        try {
            const raw = localStorage.getItem('belen_cache_recorrido_ids_v20');
            if (raw) return JSON.parse(raw);
        } catch (e) {}
        return null;
    }

    function asegurarCasosClinicosRecorrido(forzarRecreacion) {
        try {
            sembrarAgendaQuirurgica20Dias(forzarRecreacion);
            const guardados = obtenerIdsCacheRecorrido();
            if (guardados && guardados.t2 && obtenerTurno(guardados.t2) && !forzarRecreacion) {
                return guardados;
            }

            // Si estamos recreando, limpiar turnos previos de los 4 pacientes del caché
            const nombresDemo = [
                'CARLOS ALBERTO MENDOZA RUIZ',
                'MARIA ELENA GOMEZ VALDEZ',
                'VALERIA SOFIA HERNANDEZ LUNA',
                'JORGE LUIS NAVARRO PINEDA'
            ];
            if (forzarRecreacion) {
                const turnosPrevios = listarTurnos().filter(t => nombresDemo.includes(normalizar(t.nombre || t.paciente_nombre || ''))).map(t => t.turno_id);
                if (turnosPrevios.length) {
                    escribir(CLAVES.turnos, listarTurnos().filter(t => !turnosPrevios.includes(t.turno_id)));
                    escribir(CLAVES.internamientos, listarInternamientos().filter(i => !turnosPrevios.includes(i.turno_id)));
                    escribir(CLAVES.hospitalizados, listarHospitalizados().filter(h => !turnosPrevios.includes(h.turno_id)));
                    escribir(CLAVES.cirugias, listarCirugias().filter(c => !turnosPrevios.includes(c.turno_id)));
                }
            }

            const crearLlegadaCache = (datos) => {
                const pac = guardarPaciente({
                    nombres: datos.nombres,
                    apellido_paterno: datos.apellido_paterno,
                    apellido_materno: datos.apellido_materno,
                    nombre_completo: [datos.nombres, datos.apellido_paterno, datos.apellido_materno].filter(Boolean).join(' '),
                    fecha_nacimiento: datos.fecha_nacimiento,
                    sexo: datos.sexo,
                    telefono: datos.telefono,
                    direccion: datos.direccion || 'Av. Francisco Medina Ascencio 410, Puerto Vallarta',
                    nacionalidad: 'Mexicana'
                });
                return crearTurno({
                    paciente_id: pac.paciente_id,
                    especialidad_codigo: datos.especialidad_codigo,
                    medico_id: datos.medico_id,
                    motivo: datos.motivo,
                    permitir_duplicado: true
                });
            };

            const sesTriage = sesionParaCache('enf_triage');
            const sesHosp = sesionParaCache('enf_hospital');
            const sesJuan = sesionParaCache('dr_juan');
            const sesInternista = sesionParaCache('dr_internista');
            const sesRoberto = sesionParaCache('dr_roberto');
            const sesPatricia = sesionParaCache('dra_patricia');
            const sesPediatra = sesionParaCache('dr_carlos_ped');
            const sesAdmin = sesionParaCache('administrador');

            // 1. ESCENARIO 1: Consulta Externa + 2 medicamentos en 1 jeringa + Pre-cobro en Caja
            const t1 = crearLlegadaCache({
                nombres: 'CARLOS ALBERTO', apellido_paterno: 'MENDOZA', apellido_materno: 'RUIZ',
                fecha_nacimiento: '1985-04-12', sexo: 'M', telefono: '3221234567',
                especialidad_codigo: 'MEDICINA_GENERAL', medico_id: 'dr_juan',
                motivo: 'Lumbalgia mecánica aguda post-esfuerzo'
            });
            guardarSignos(t1.turno_id, {
                ta_sistolica: 130, ta_diastolica: 84, frecuencia_cardiaca: 82, frecuencia_respiratoria: 18, temperatura_c: 36.6, spo2_porcentaje: 98, peso_kg: 78, talla_m: 1.74
            }, sesTriage);
            pasarAMedico(t1.turno_id, sesTriage);
            iniciarConsulta(t1.turno_id, sesJuan);
            const inv = listarInventarioFarmacia();
            const sku1 = (inv[0] || { sku: 'MED-001' }).sku;
            const sku2 = (inv[1] || inv[0] || { sku: 'MED-002' }).sku;
            enviarOrdenAplicacion({
                turno_id: t1.turno_id,
                diagnostico: 'Lumbalgia aguda (M54.5)',
                items: [
                    { origen: 'INVENTARIO', sku: sku1, nombre_libre: 'Ketorolaco 30 mg/mL sol. iny.', dosis: '30 mg (1 ámpula)', via: 'Intramuscular', frecuencia: 'Dosis única', duracion: 'Aplicación en clínica (en la misma jeringa con Dexametasona)', cantidad: 1 },
                    { origen: 'INVENTARIO', sku: sku2, nombre_libre: 'Dexametasona 8 mg/2 mL sol. iny.', dosis: '8 mg (1 ámpula)', via: 'Intramuscular', frecuencia: 'Dosis única', duracion: 'Aplicación en clínica (en la misma jeringa con Ketorolaco)', cantidad: 1 }
                ]
            }, sesJuan);
            agregarCargoTurno(t1.turno_id, { concepto: 'Aplicación de inyección IM en clínica', precio_unitario: 80, aplica_iva: false }, sesTriage);
            agregarCargoTurno(t1.turno_id, { concepto: 'Ketorolaco 30 mg ámpula IM', precio_unitario: 45, aplica_iva: false }, sesTriage);
            agregarCargoTurno(t1.turno_id, { concepto: 'Dexametasona 8 mg ámpula IM', precio_unitario: 55, aplica_iva: false }, sesTriage);
            agregarCargoTurno(t1.turno_id, { concepto: 'Jeringa desechable 5 mL con aguja (1 pza para ambos medicamentos)', precio_unitario: 18, aplica_iva: true }, sesTriage);
            liberarConsultaACaja(t1.turno_id, sesJuan);
            cerrarExpedientePagado(t1.turno_id, sesAdmin, { pre_cobro: true });
            actualizarTurno(t1.turno_id, { estatus: 'alta', destino: 'Alta', dx_principal: 'Lumbalgia mecánica aguda resuelta' });

            // 2. ESCENARIO 2: Hospitalización de 5 días (Observación sin hojas Qx -> Interconsulta -> TAC + Labs -> Cirugía con Alfonso -> Hoja Qx -> Pre-Alta)
            const t2 = crearLlegadaCache({
                nombres: 'MARIA ELENA', apellido_paterno: 'GOMEZ', apellido_materno: 'VALDEZ',
                fecha_nacimiento: '1972-08-20', sexo: 'F', telefono: '3229876543',
                especialidad_codigo: 'MEDICINA_GENERAL', medico_id: 'dr_juan',
                motivo: 'Cefalea holocraneana intensa EVA 9/10 y mareo'
            });
            guardarSignos(t2.turno_id, {
                ta_sistolica: 158, ta_diastolica: 96, frecuencia_cardiaca: 92, frecuencia_respiratoria: 19, temperatura_c: 36.7, spo2_porcentaje: 97, peso_kg: 68, talla_m: 1.62
            }, sesTriage);
            pasarAMedico(t2.turno_id, sesTriage);
            iniciarConsulta(t2.turno_id, sesJuan);
            actualizarTurno(t2.turno_id, { estatus: 'internado', destino: 'Internamiento', area_destino: 'Observación', cama_codigo: 'OBS-1', cama: 'Observación · Cama 1', dx_principal: 'Cefalea intensa en estudio' });
            const int2 = sincronizarInternamiento(t2.turno_id, {
                consulta: { destino: 'Internamiento', fecha_hora: new Date().toISOString() },
                ingreso: { area_destino: { codigo: 'OBSERVACION', descripcion: 'Observación' } },
                diagnosticos: [{ cie10_codigo: 'R51', descripcion: 'Cefalea intensa refractaria a analgesia inicial' }],
                indicaciones: {
                    dieta: 'Ayuno temporal por náusea',
                    soluciones_parenterales: [{ solucion: 'Solución Salina 0.9% 1000 mL p/12h' }],
                    medicamentos: [{ nombre: 'Paracetamol 1 g IV c/8h' }, { nombre: 'Ondansetrón 8 mg IV c/12h' }],
                    medidas_generales: 'SVT y vigilancia neurológica estrecha en Observación'
                }
            }, { finalizado: true });
            asignarCama(t2.turno_id, 'OBS-1', sesJuan);
            guardarHojaEnfermeria(t2.turno_id, {
                signos: [
                    { turno: 'Matutino', hora: '08:00', ta: '150/92', fc: '88', fr: '18', temp: '36.6', spo2: '97%', texto: 'TA 150/92, FC 88, FR 18, Temp 36.6, SpO2 97%' },
                    { turno: 'Vespertino', hora: '14:00', ta: '136/84', fc: '78', fr: '17', temp: '36.5', spo2: '98%', texto: 'TA 136/84, FC 78, FR 17, Temp 36.5, SpO2 98%' }
                ],
                kardex: [
                    { turno: 'Matutino', hora: '08:30', medicamento: 'Paracetamol 1 g IV + Ondansetrón 8 mg IV' }
                ],
                balance: { ingresos: [{ turno: 'Matutino', concepto: 'Sol. Salina 0.9%', ml: 500 }], egresos: [{ turno: 'Matutino', concepto: 'Uresis', ml: 420 }] },
                observaciones: 'Paciente consciente, orientada; persiste cefalea hemicraneana por lo que se solicita valoración por Medicina Interna.'
            }, sesTriage);

            agregarNotaEvolucion(int2.internamiento_id, {
                subjetivo: 'Día 2: Paciente persiste con cefalea intensa y acúfenos.',
                signos_vitales: { ta_sistolica: 155, ta_diastolica: 95, frecuencia_cardiaca: 88, frecuencia_respiratoria: 18, temperatura_c: 36.6, spo2_porcentaje: 97 },
                exploracion_fisica: 'Consciente, orientada, sin focalización motora pero dolor refractario.',
                diagnostico_actualizado: 'Cefalea secundaria en estudio',
                analisis: 'Cefalea secundaria en estudio; amerita valoración por Medicina Interna y pase a piso de Hospitalización.',
                plan: 'Se solicita interconsulta a Medicina Interna y pase a Hospitalización.'
            }, sesJuan);

            const icMI = solicitarInterconsulta(int2.internamiento_id, {
                especialidad_codigo: 'MEDICINA_INTERNA', medico_id: 'dr_internista',
                motivo: 'Cefalea refractaria y descontrol hipertensivo para abordaje diagnóstico integral'
            }, sesJuan);
            const camaLibreHosp = (camasLibres('HOSPITALIZACION')[0] || { codigo: 'HOSP-3' }).codigo;
            cambiarAreaEstancia(t2.turno_id, 'HOSPITALIZACION', camaLibreHosp, sesTriage);

            if (icMI && icMI.interconsulta) {
                responderInterconsulta(int2.internamiento_id, icMI.interconsulta.interconsulta_id, {
                    hallazgos: 'Soplo carotídeo derecho grado II/VI y cefalea hemicraneana ipsilateral.',
                    diagnostico: 'Sospecha de estenosis carotídea sintomática / patología vascular extracraneal.',
                    plan_recomendaciones: 'Solicito Tomografía de Cráneo Simple (TAC), Ultrasonido Doppler Carotídeo, perfil bioquímico e interconsulta a Angiología.'
                }, sesInternista);
            }

            const solEst = solicitarEstudiosHospital(int2.internamiento_id, {
                estudios: [
                    { tipo: 'TOMOGRAFIA', prioridad: 'URGENTE', nombre: 'Tomografía de Cráneo Simple (TAC)', precio_unitario: 3200, motivo_clinico: 'Descartar evento isquémico/hemorrágico intracraneal' },
                    { tipo: 'LABORATORIO', prioridad: 'URGENTE', nombre: 'Biometría Hemática, Química Sanguínea y Tiempos de Coagulación (TP/TTPa)', precio_unitario: 950, motivo_clinico: 'Protocolo vascular y preoperatorio' }
                ]
            }, sesInternista);
            if (solEst && Array.isArray(solEst.estudios)) {
                solEst.estudios.forEach(ord => {
                    confirmarEstudioEnfermeria(int2.internamiento_id, ord.item_id, {
                        observaciones_realizacion: 'Estudio realizado y reportado a Medicina Interna sin complicaciones.',
                        cargar_cuenta: true
                    }, sesHosp);
                });
            }

            const progQx = programarCirugia({
                turno_id: t2.turno_id, paciente_id: int2.paciente_id, nombre: 'MARIA ELENA GOMEZ VALDEZ', fecha_nacimiento: '1972-08-20',
                tipo_estancia: 'HOSPITALIZACION', procedimiento: 'Exploración y plastía vascular reglada',
                sala: SALAS_QUIROFANO[0].codigo, fecha: hoyLocal(), hora_inicio: '16:00', duracion_minutos: 90,
                medico_cirujano_id: 'dr_roberto', anestesiologo_id: 'dra_elena',
                requiere_valoracion_preoperatoria: true, internista_id: 'dr_internista',
                indicaciones_preoperatorias: 'Ayuno de 8 horas, vendaje compresivo, reserva de hemoderivados.'
            }, sesRoberto);
            if (progQx && progQx.cirugia) {
                confirmarCirugiaAdmin(progQx.cirugia.cirugia_id, {
                    anestesiologo_id: 'dra_elena',
                    ayudante_nombre: 'Dr. Marco Antonio Vega (1er Ayudante)',
                    instrumentista_nombre: 'Lic. Enf. Sofía Ríos (Instrumentista)',
                    circulante_nombre: 'Enf. Carmen López (Circulante)'
                }, sesAdmin);
            }

            guardarValoracionPreoperatoria(t2.turno_id, {
                diagnostico_preoperatorio: 'Patología vascular sintomática + Hipertensión arterial controlada',
                cirugia_programada: 'Exploración y plastía vascular reglada',
                asa: 'II', goldman: 'I', plan_preoperatorio: 'Riesgo quirúrgico aceptable; se autoriza procedimiento programado con monitoreo invasivo.'
            }, sesInternista);

            const prefillQx = prefillHojaQuirurgica(t2.turno_id);
            guardarNotaPostoperatoria(t2.turno_id, {
                cama: camaLibreHosp,
                preoperatorio: prefillQx.preoperatorio,
                postoperatorio: 'Patología vascular corregida quirúrgicamente sin complicaciones',
                operacion_planeada: prefillQx.operacion_planeada,
                operacion_realizada: 'Exploración y plastía vascular reglada exitosa',
                cirujano: prefillQx.cirujano,
                ayudante: prefillQx.ayudante,
                instrumentista: prefillQx.instrumentista,
                anestesiologo: prefillQx.anestesiologo,
                circulante: prefillQx.circulante,
                descripcion_tecnica: 'Control vascular proximal y distal, plastía con prolene 6-0, hemostasia verificada.',
                hallazgos: 'Placa estenótica resuelta con flujo distal trifásico restaurado.',
                incidentes_accidentes: 'Ninguno',
                sangrado: '120 mL',
                gasas_compresas: 'Cuenta completa verificada por Lic. Enf. Sofía Ríos y Enf. Carmen López',
                biopsia: 'No aplica',
                piezas: 'Placa enviada a patología',
                drenajes: 'Sin drenajes',
                estado_postquirurgico: 'Estable, pulsos distales presentes, pasa a recuperación y cama ' + camaLibreHosp,
                plan_postoperatorio: 'Vigilancia neurovascular, analgesia IV y alta conjunta al Día 5.'
            }, sesRoberto);

            registrarAltaPorServicio(int2.internamiento_id, {
                resumen_servicio: 'Día 5: Herida quirúrgica limpia, pulsos íntegros. Se otorga pre-alta por Angiología.',
                indicaciones_servicio: 'AAS 100 mg VO c/24h, retiro de puntos en 10 días.',
                continua_a_cargo_de: 'Medicina Interna (Dr. Alejandro Morales) para alta hospitalaria definitiva'
            }, sesRoberto);

            // 3. ESCENARIO 3: Embarazada que entra directo a Parto SIN pasar por consulta externa
            const progParto = programarCirugia({
                nombres: 'VALERIA SOFIA', apellido_paterno: 'HERNANDEZ', apellido_materno: 'LUNA',
                nombre: 'VALERIA SOFIA HERNANDEZ LUNA', fecha_nacimiento: '1996-11-05', sexo: 'F',
                tipo_estancia: 'HOSPITALIZACION', procedimiento: 'Atención de Parto Eutócico Humanizado',
                sala: SALAS_QUIROFANO[0].codigo, fecha: hoyLocal(), hora_inicio: '18:30', duracion_minutos: 60,
                medico_cirujano_id: 'dra_patricia', anestesiologo_id: 'dra_elena',
                requiere_pediatra: true, pediatra_id: 'dr_carlos_ped',
                indicaciones_preoperatorias: 'Ingreso directo a labor/parto, monitoreo fetal continuo.'
            }, sesPatricia);
            const ingParto = ingresarPacienteAmbulatorio(progParto.cirugia.cirugia_id, sesHosp);
            const t3Id = ingParto.turno.turno_id;
            const int3Id = ingParto.internamiento.internamiento_id;

            guardarNotaIngresoDirectoHospital(int3Id, {
                motivo_ingreso: 'Embarazo de 39.4 SDG en trabajo de parto fase activa (dilatación 6 cm).',
                antecedentes_heredofamiliares: 'Interrogados y negados.',
                antecedentes_personales: 'G2 P1 C0 A0, control prenatal normoevolutivo (7 consultas), Grupo y Rh O positivo, alergias NEGADAS.',
                exploracion_fisica: 'TA 115/74, FC 80, Temp 36.6. Abdomen con AFU 33 cm, PUVLC, FCF 144 lpm, tacto vaginal con dilatación 6 cm, borramiento 80%, membranas íntegras.',
                diagnostico_ingreso: 'Embarazo de 39.4 SDG en trabajo de parto fase activa (O80.0)',
                pronostico: 'Favorable para el binomio materno-fetal',
                plan_manejo: 'Conducción y atención de parto eutócico y recepción neonatal por Pediatría.'
            }, sesPatricia);

            guardarNotaParto(t3Id, {
                tipo_parto: 'Parto Eutócico Humanizado',
                fecha_nacimiento_rn: hoyLocal(),
                hora_nacimiento_rn: '08:42',
                alumbramiento: 'Dirigido (Schultze), placenta y membranas completas',
                episiotomia: 'Mediolateral derecha reparada con Catgut crómico 2-0 sin complicaciones',
                sangrado_ml: 250,
                sexo_rn: 'Femenino',
                peso_rn_g: 3320,
                talla_rn_cm: 50,
                apgar: '9 / 9',
                capurro_sdg: '39.4',
                observaciones: 'Recién nacida vigorosa, apego inmediato y lactancia materna temprana.'
            }, sesPatricia);

            guardarHojaRecienNacido(t3Id, {
                sexo_rn: 'Femenino',
                fecha_nacimiento_rn: hoyLocal(),
                hora_nacimiento_rn: '08:42',
                apgar_1: 9,
                apgar_5: 9,
                silverman: 0,
                capurro_sdg: '39.4',
                peso_gramos: 3320,
                talla_cm: 50,
                perimetro_cefalico_cm: 34.5,
                exploracion_fisica_rn: 'RN femenina de término adecuada para edad gestacional, fontanelas normotensas, paladar íntegro, campos pulmonares bien ventilados, sin soplos, reflejos primitivos presentes (sin Tamiz).'
            }, sesPediatra);

            // 4. ESCENARIO 4: Paciente en Observación que solicita Alta Voluntaria (Exoneración NOM-004 y Art. 79 RLGSPSAM)
            const t4 = crearLlegadaCache({
                nombres: 'JORGE LUIS', apellido_paterno: 'NAVARRO', apellido_materno: 'PINEDA',
                fecha_nacimiento: '1968-02-14', sexo: 'M', telefono: '3224445566',
                especialidad_codigo: 'MEDICINA_GENERAL', medico_id: 'dr_juan',
                motivo: 'Dolor abdominal epigástrico y vómito'
            });
            guardarSignos(t4.turno_id, {
                ta_sistolica: 138, ta_diastolica: 86, frecuencia_cardiaca: 90, frecuencia_respiratoria: 18, temperatura_c: 37.1, spo2_porcentaje: 97, peso_kg: 82, talla_m: 1.72
            }, sesTriage);
            pasarAMedico(t4.turno_id, sesTriage);
            iniciarConsulta(t4.turno_id, sesJuan);
            actualizarTurno(t4.turno_id, { estatus: 'internado', destino: 'Internamiento', area_destino: 'Observación', cama_codigo: 'OBS-2', cama: 'Observación · Cama 2', dx_principal: 'Dolor abdominal agudo en estudio' });
            const int4 = sincronizarInternamiento(t4.turno_id, {
                consulta: { destino: 'Internamiento', fecha_hora: new Date().toISOString() },
                ingreso: { area_destino: { codigo: 'OBSERVACION', descripcion: 'Observación' } },
                diagnosticos: [{ cie10_codigo: 'R10.1', descripcion: 'Dolor abdominal agudo en estudio' }]
            }, { finalizado: true });
            asignarCama(t4.turno_id, 'OBS-2', sesJuan);
            const preAV = Object.assign({}, prefillAltaVoluntaria(t4.turno_id, sesJuan), {
                testigo1_nombre: 'Rosa Elena Pineda Vargas (Hermana)',
                testigo1_domicilio: 'Av. Las Torres 504, Col. El Pitillal, Puerto Vallarta',
                testigo2_nombre: 'Enf. Laura Gómez (Enfermería en turno)',
                testigo2_domicilio: 'Sanatorio Belén · Juárez #452, Centro, Puerto Vallarta'
            });
            registrarAltaVoluntaria(int4.internamiento_id, preAV, sesJuan);

            const ids = {
                t1: t1.turno_id,
                t2: t2.turno_id,
                int2: int2.internamiento_id,
                t3: t3Id,
                int3: int3Id,
                t4: t4.turno_id,
                int4: int4.internamiento_id
            };
            localStorage.setItem('belen_cache_recorrido_ids_v20', JSON.stringify(ids));
            localStorage.setItem('belen_cache_recorrido_v20', '1');
            return ids;
        } catch (err) {
            console.warn('Error al sembrar casos clínicos del recorrido:', err);
            return null;
        }
    }

    function obtenerDocumentosCacheRecorrido() {
        const ids = asegurarCasosClinicosRecorrido(false) || obtenerIdsCacheRecorrido() || {};
        const docs = [];
        const int2 = ids.int2 ? obtenerInternamiento(ids.int2) : (ids.t2 ? internamientoDeTurno(ids.t2) : null);
        const int3 = ids.int3 ? obtenerInternamiento(ids.int3) : (ids.t3 ? internamientoDeTurno(ids.t3) : null);
        const int4 = ids.int4 ? obtenerInternamiento(ids.int4) : (ids.t4 ? internamientoDeTurno(ids.t4) : null);

        if (int2) {
            const hEnf = obtenerHojaEnfermeria(int2.turno_id);
            docs.push({
                id: 'doc-enf-c2',
                escenario: 'Escenario 2 · Hospitalización 5 Días (María Elena Gómez Valdez)',
                titulo: 'Hoja Clínica de Enfermería (Signos por Turno, Balance Hídrico y Medicamentos)',
                norma: 'NOM-004-SSA3-2012',
                turno_id: int2.turno_id,
                html: htmlImpresionHojaEnfermeria(hEnf, int2.turno_id)
            });
            docs.push({
                id: 'doc-est-c2',
                escenario: 'Escenario 2 · Hospitalización 5 Días (María Elena Gómez Valdez)',
                titulo: 'Solicitud y Confirmación de Estudios de Imagenología (TAC de Cráneo) y Laboratorio',
                norma: 'NOM-004-SSA3-2012',
                turno_id: int2.turno_id,
                html: htmlImpresionOrdenesEstudios(int2. estudios_solicitados || [], int2.turno_id)
            });
            if (Array.isArray(int2.interconsultas) && int2.interconsultas.length) {
                int2.interconsultas.forEach((ic, idx) => {
                    docs.push({
                        id: 'doc-ic-c2-' + idx,
                        escenario: 'Escenario 2 · Hospitalización 5 Días (María Elena Gómez Valdez)',
                        titulo: 'Nota de Interconsulta Médica · ' + (ic.especialidad_nombre || ic.especialidad_codigo || 'Medicina Interna'),
                        norma: 'NOM-004-SSA3-2012 numeral 6.3',
                        turno_id: int2.turno_id,
                        html: htmlImpresionNotaInterconsulta(ic, int2.turno_id)
                    });
                });
            }
            if (int2.valoracion_preoperatoria) {
                docs.push({
                    id: 'doc-vpre-c2',
                    escenario: 'Escenario 2 · Hospitalización 5 Días (María Elena Gómez Valdez)',
                    titulo: 'Nota de Valoración Preoperatoria (ASA / Goldman)',
                    norma: 'NOM-004-SSA3-2012',
                    turno_id: int2.turno_id,
                    html: htmlImpresionValoracionPreoperatoria(int2.valoracion_preoperatoria, int2.turno_id)
                });
            }
            const preQx = prefillHojaQuirurgica(int2.turno_id);
            const cir2 = cirugiaPara(int2.turno_id) || {};
            const notaQx = (cir2 && cir2.nota_postoperatoria) || int2.nota_postoperatoria || {
                servicio: "Angiología y Cirugía Vascular",
                fecha_programacion: hoyLocal(),
                dx_pre: preQx.preoperatorio || "Insuficiencia vascular sintomática",
                operacion: preQx.operacion_planeada || "Exploración y plastía vascular reglada",
                fecha_hora_quirurgica: hoyLocal() + " 16:00 hrs",
                tecnica: "Control vascular proximal y distal, plastía con prolene 6-0, hemostasia verificada.",
                hallazgos: "Placa estenótica resuelta con flujo distal trifásico restaurado.",
                recuento: "Cuenta completa de gasas y compresas verificada por Lic. Enf. Sofía Ríos y Enf. Carmen López",
                sangrado_ml: 120,
                uresis: "180 mL clara",
                tipo_anestesia: "Bloqueo regional / Sedación",
                dx_post: "Patología vascular corregida quirúrgicamente sin complicaciones",
                firmantes: {
                    cirujano: preQx.cirujano,
                    ayudante: preQx.ayudante,
                    anestesiologo: preQx.anestesiologo,
                    instrumentista: preQx.instrumentista,
                    circulante: preQx.circulante
                }
            };
            docs.push({
                id: 'doc-hqx-c2',
                escenario: 'Escenario 2 · Hospitalización 5 Días (María Elena Gómez Valdez)',
                titulo: 'Hoja Quirúrgica / Nota Postoperatoria (Con Equipo Confirmado por Alfonso)',
                norma: 'NOM-004-SSA3-2012 numeral 8.8',
                turno_id: int2.turno_id,
                html: htmlHojaQuirurgica(notaQx, {
                    expediente: int2.paciente_id,
                    cama: int2.cama_codigo || "HOSP-3",
                    servicio: "Angiología y Cirugía Vascular",
                    fecha_programacion: hoyLocal(),
                    nombre: "MARIA ELENA GOMEZ VALDEZ",
                    edad: "54 años",
                    sexo: "Femenino",
                    dx_pre: preQx.preoperatorio,
                    operacion: preQx.operacion_planeada,
                    fecha_hora_quirurgica: hoyLocal() + " 16:00 hrs",
                    cirujano: preQx.cirujano,
                    ayudante: preQx.ayudante,
                    anestesiologo: preQx.anestesiologo,
                    instrumentista: preQx.instrumentista,
                    circulante: preQx.circulante
                })
            });
        }
        if (int3) {
            docs.push({
                id: 'doc-ingdir-c3',
                escenario: 'Escenario 3 · Embarazada Directo a Parto (Valeria Sofía Hernández Luna)',
                titulo: 'Nota de Ingreso Hospitalario Directo e Historia Clínica (Sin Consulta Externa)',
                norma: 'NOM-004-SSA3-2012',
                turno_id: int3.turno_id,
                html: htmlImpresionNotaIngresoDirecto(int3.nota_ingreso_directo, int3.turno_id)
            });
            docs.push({
                id: 'doc-parto-c3',
                escenario: 'Escenario 3 · Embarazada Directo a Parto (Valeria Sofía Hernández Luna)',
                titulo: 'Nota de Atención de Parto Eutócico y Alumbramiento',
                norma: 'NOM-007-SSA2-2016 / NOM-004',
                turno_id: int3.turno_id,
                html: htmlImpresionNotaParto(int3.nota_parto, int3.turno_id)
            });
            docs.push({
                id: 'doc-rn-c3',
                escenario: 'Escenario 3 · Embarazada Directo a Parto (Valeria Sofía Hernández Luna)',
                titulo: 'Hoja de Recién Nacido (Pediatría / Cunero · Sin Tamiz)',
                norma: 'NOM-007-SSA2-2016',
                turno_id: int3.turno_id,
                html: htmlImpresionHojaRecienNacido(int3.hoja_recien_nacido, int3.turno_id)
            });
        }
        if (int4 && int4.alta_voluntaria) {
            docs.push({
                id: 'doc-altavol-c4',
                escenario: 'Escenario 4 · Alta Voluntaria desde Observación (Jorge Luis Navarro Pineda)',
                titulo: 'Hoja de Egreso Voluntario y Responsiva Médico-Legal (Exoneración Total)',
                norma: 'NOM-004-SSA3-2012 numeral 10.2 y Art. 79 RLGSPSAM',
                turno_id: int4.turno_id,
                html: htmlImpresionCartaAltaVoluntaria(int4.alta_voluntaria, int4.turno_id)
            });
        }
        return docs;
    }

    // Borra TODA la información operativa del demo (no toca los machotes) y vuelve a sembrar
    function restablecerDemo() {
        [CLAVES.catalogo, CLAVES.turnos, CLAVES.visitas, CLAVES.borradores, CLAVES.hospitalizados, CLAVES.internamientos, CLAVES.correcciones, CLAVES.cirugias, CLAVES.farmacia, CLAVES.estudios, CLAVES.estudiosV3, CLAVES.surtido, CLAVES.paquetes, CLAVES.cajasEstupefacientes, CLAVES.salidasFarmacia, CLAVES.movimientosFarmacia, CLAVES.recetasFoliadas, CLAVES.recetas, CLAVES.folioRecetaSeq, CLAVES.folioExternoSeq, CLAVES.demoQxActivo, CLAVES.ivaDiferido, CLAVES.farmaciaAmpliada, CLAVES.demo, 'belen_seed_v18', 'belen_seed_v19'].forEach(k => localStorage.removeItem(k));   // los interruptores de personal se conservan
        return sembrarDemoSiHaceFalta();
    }

    global.BelenStore = {
        CLAVES, ESPECIALIDADES, ROLES, ENFERMERIAS, PERSONAL_OPERATIVO, USUARIOS, COLORES_DISTINTIVO, ACCIONES_PERSONAL, PERMISOS, MODULOS, ESTATUS, ETIQUETA_ESTATUS, ESTATUS_EN_FILA, RANGOS_SIGNOS, SIGNOS_OBLIGATORIOS,
        SALAS_QUIROFANO, DURACIONES_CIRUGIA, TIPOS_ESTANCIA_QX, ESPECIALIDADES_QUIRURGICAS, QX_DIA_INICIO, QX_DIA_FIN, AREA_AMBULATORIO_QX, MODALIDAD_AMBULATORIO_QX,
        CAMAS_HOSPITAL, QX_TRASLADO_MINUTOS, TECNICAS_ANESTESIA, MEDS_ANESTESIA, UBICACION_QX,
        leer, escribir, normalizar, limpiarEspacios, hoyLocal, parseFechaISO, calcularEdad, calcularEdadDetallada, formatearEdad, fechaLegibleISO, iniciales, formatoReloj, hashContrasena, colorDeUsuario,
        DATOS_CORPORATIVOS_BELEN, CATALOGO_CIE10, buscarCIE10, CASO_REAL_MICHELLE, CATALOGO_FORMATOS_OFICIALES, asegurarCasoRealMichelle,
        iniciarSesion, sesion, cerrarSesion, puede, esEnfermeria, moduloAplicaARol, permisoModuloDe, permisoModuloExplicito, establecerPermisoModulo, permisoAccionDe, establecerPermisoAccion, restablecerPermisosPersonal, leerPermisosPersonal, especialidadPorCodigo, medicosDeEspecialidad, identificarOperadorFarmacia,
        guardarUsuario, desactivarUsuario, reactivarUsuario, eliminarUsuario, listarPapeleria, agregarDocumentoPersonal, eliminarDocumentoPersonal,
        listarPacientes, buscarPacientePorIdentidad, buscarPacientesPorNombre, buscarPacientePorId, homonimos, guardarPaciente, partesDeNombre, fusionarExpedientes,
        listarTurnos, leerTurnos: listarTurnos, listarUsuarios, obtenerTurno, actualizarTurno, siguienteNumeroTurno, crearTurno, ordenarPorLlegada, turnoVisiblePara, filaDe, colaEspera, pacientesEnConsulta, posicionEnCola, posicionNuevaEnCola, siguienteEnCola, corteDiario, metricas24h,
        listarCirugias, fichaCirugia, proximasCirugias, cirugiasVisibles, cirugiaVisiblePara, cirugiaPara, cirujanos, anestesiologos, disponibilidadQuirofano, validarCirugia, programarCirugia, asignarAnestesiologo, puedeIngresarAmbulatorio, ingresarPacienteAmbulatorio, hospitalizadosDe, hospitalizadoVisiblePara,
        camasLibres, flujoQuirofanoDe, pasarPacienteAQuirofano, recibirEnQuirofano, regresarAHospitalizacion, datosHojaTransanestesica,
        guardarNotaPostanestesica, guardarNotaPostoperatoria, prefillHojaQuirurgica, htmlModalHojaQuirurgica, leerNotaPostoperatoria, htmlHojaQuirurgica, altaAmbulatoriaQx, convertirAmbulatorioAPiso,
        puedeImprimirHojaTrans, puedeNotaPostanestesica, puedeNotaPostoperatoria, puedeAltaAmbulatoria, puedeConvertirAPiso, puedeRegresarAPiso,
        validarSignos, alertasSignosVitales, signosCompletos, resumenSignos, guardarSignos,
        pasarAMedico, iniciarConsulta, accesoExpediente,
        leerBorrador, guardarBorrador, borrarBorrador,
        listarVisitas, registrarVisita, visitasDePaciente, piezasClinicasPaciente, antecedentesLongitudinales,
        CEDULAS_FIRMA, esMedicoGeneral, especialidadImpresaMedico, lineasCedulaFirma, textoCedulasFirma, resumenCedulas, guardarCedulasVisibles,
        listarHospitalizados, guardarHospitalizado,
        listarInternamientos, internamientoDeTurno, obtenerInternamiento, resolverInternamiento, asegurarInternamiento, sincronizarInternamiento, descartarInternamiento,
        fichaHospitalizado, accesoVisorHospitalizado, relacionMedico, tieneInterconsulta, medicosParaInterconsulta, solicitarInterconsulta,
        validarNotaEvolucion, agregarNotaEvolucion, indicacionesVigentes, agregarHojaIndicaciones, asignarCama,
        normalizarCodigoCama, resolverCama, camaPorCodigo, monitorCamas, etiquetaCama, codigoAreaEstancia, areasDestinoEstancia, nombreAreaEstancia, puedeCambiarArea, cambiarAreaEstancia, previewCorteEstancia, aplicarCorteEstancia,
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
        obtenerHojaEnfermeria, guardarHojaEnfermeria, TURNOS_ENFERMERIA,
        liberarConsultaACaja, actualizarCostoConsultaMedico, registrarTurno, turnoActivoEnEspecialidad, buscarPacientes, guardarNotaEgreso, asegurarCargoConsulta, sincronizarCuentaEspejo,
        expandirAbreviaturasMedicas, detectarFraccionItemReceta, confirmarCirugiaAdmin, moverPacienteEnPlano,
        responderInterconsulta, htmlImpresionNotaInterconsulta,
        guardarValoracionPreoperatoria, htmlImpresionValoracionPreoperatoria,
        guardarHojaRecienNacido, htmlImpresionHojaRecienNacido,
        guardarNotaParto, htmlImpresionNotaParto,
        htmlImpresionNotaPreanestesica, htmlImpresionRegistroTransanestesico, htmlImpresionNotaPostanestesica,
        htmlHojaTransanestesicaBlanco,
        solicitarEstudiosHospital, confirmarEstudioEnfermeria, htmlImpresionOrdenesEstudios,
        htmlImpresionHojaEnfermeria, registrarAltaPorServicio,
        prefillAltaVoluntaria, registrarAltaVoluntaria, htmlImpresionCartaAltaVoluntaria,
        guardarNotaIngresoDirectoHospital, htmlImpresionNotaIngresoDirecto,
        BITACORA_CACHE_AVANCES, asegurarCasosClinicosRecorrido, obtenerDocumentosCacheRecorrido, obtenerIdsCacheRecorrido
    };
    sembrarUsuariosSiHaceFalta();
    completarAnestesiologoCirugias();
    migrarCirugiasFase1();
    sembrarFarmaciaSiHaceFalta();
    normalizarIvaDiferido();
    sembrarDemoSiHaceFalta();
    asegurarCasosClinicosRecorrido(false);
})(window);
