// Archivo: js/admin-api.js

const AdminAPI = {
    // ==========================================
    // MÓDULO DEL MÉDICO (SALA DE ESPERA)
    // ==========================================
    obtenerSalaEsperaMedico: async function() {
        return [
            {
                id: "P101",
                nombre: "Laura Méndez",
                edad: 34,
                motivo: "Dolor abdominal desde hace 2 horas",
                tiempoEspera: "10 min",
                signos: { ta: "120/80", fc: "72", temp: "36.5", spo2: "98" },
                enfermera: "Enf. Lupita",
                prioridad: "media", colorPrioridad: "amber"
            },
            {
                id: "P102",
                nombre: "Carlos Ruiz",
                edad: 45,
                motivo: "Revisión de estudios de laboratorio",
                tiempoEspera: "2 min",
                signos: { ta: "130/85", fc: "80", temp: "36.0", spo2: "99" },
                enfermera: "Enf. Lupita",
                prioridad: "baja", colorPrioridad: "emerald"
            }
        ];
    },

    // ==========================================
    // MÓDULOS DE ADMINISTRADOR (Lo que ya teníamos)
    // ==========================================
    obtenerPacientesActivos: async function() {
        return [
            { id: "P001", nombre: "Laura Méndez", area: "Hospitalización", servicio: "Traumatología", medico: "Dr. Roberto Silva", ingreso: "28 Jul, 10:30 AM", cuentaActual: 14500.00, colorArea: "blue" },
            { id: "P003", nombre: "Carlos Ruiz", area: "Recuperación", servicio: "Cirugía General", medico: "Dr. Arturo Gómez", ingreso: "Hoy, 10:00 AM", cuentaActual: 28900.00, colorArea: "emerald" }
        ];
    },
    obtenerCirugiasProgramadas: async function() {
        return [
            { id: "C001", paciente: "María Fernández", cirujano: "Dr. Arturo Gómez", anestesiólogo: "Dra. Elena Ríos", fechaHora: "Hoy, 18:00 PM", procedimiento: "Colecistectomía", notasAlfonso: "Revisar pago deducible.", colorEtiqueta: "border-purple-500", bgEtiqueta: "bg-purple-50" }
        ];
    },
    obtenerEstadoConsultorios: async function() {
        return {
            consultorio1: { estado: "Ocupado", medico: "Dr. Juan Pérez", paciente: "Niño Liam", horario: "16:30" },
            consultorio2: { estado: "Libre", medico: "Sin asignar", paciente: "-", horario: "-" },
            triageActivo: [
                { paciente: "Héctor Salas", motivo: "Dolor agudo", enfermera: "Enf. Lupita", tiempoEspera: "5 min", asignadoA: "Médico Guardia" }
            ]
        };
    }
};
