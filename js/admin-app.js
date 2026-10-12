// Archivo: js/admin-app.js

const AdminController = {
    rolActual: null, 

    init: async function() {
        this.verificarSesion();
        this.aplicarPermisosUI();
        await this.cargarDashboardCentral();
    },

    verificarSesion: function() {
        const rol = sessionStorage.getItem('belen_rol_usuario');
        if (!rol) {
            window.location.href = 'login.html';
            return;
        }

        this.rolActual = rol;
        const nombreEl = document.getElementById('user-name');
        const rolEl = document.getElementById('user-role');

        if (rol === 'admin') {
            nombreEl.innerText = 'Alfonso'; rolEl.innerText = 'Dirección General';
        } else if (rol === 'medico') {
            nombreEl.innerText = 'Dr. Juan Pérez'; rolEl.innerText = 'Médico Especialista';
        } else if (rol === 'enfermeria') {
            nombreEl.innerText = 'Enf. Lupita'; rolEl.innerText = 'Jefa de Enfermería';
        }
    },

    aplicarPermisosUI: function() {
        const elementos = document.querySelectorAll('[data-roles]');
        elementos.forEach(el => {
            const rolesPermitidos = el.getAttribute('data-roles').split(',');
            if (!rolesPermitidos.includes(this.rolActual)) {
                el.style.display = 'none'; 
            }
        });
    },

    cerrarSesion: function() {
        sessionStorage.removeItem('belen_rol_usuario');
        window.location.href = 'login.html';
    },

    // Función para el botón del Doc "+ Nueva Consulta Directa"
    iniciarConsultaDirecta: function() {
        const nombre = prompt("Ingrese el nombre del paciente para iniciar consulta exprés:");
        if (nombre) {
            // Mandamos al doctor al expediente simulando que él captura todo
            window.location.href = 'expediente.html';
        }
    },

    cargarDashboardCentral: async function() {
        const grid = document.getElementById('admin-content');
        grid.innerHTML = ''; // Limpiamos el contenedor

        // ==========================================================
        // 1. VISTA EXCLUSIVA PARA EL MÉDICO (SALA DE ESPERA)
        // ==========================================================
        if (this.rolActual === 'medico') {
            const fila = await AdminAPI.obtenerSalaEsperaMedico();
            
            let htmlMedico = `
                <div class="flex justify-between items-end mb-8">
                    <div>
                        <h2 class="text-2xl font-extrabold text-slate-800">Mi Consultorio</h2>
                        <p class="text-slate-500">Pacientes esperando atención.</p>
                    </div>
                    <button onclick="AdminController.iniciarConsultaDirecta()" class="bg-cyan-700 hover:bg-cyan-800 text-white font-bold py-3 px-6 rounded-xl shadow-md transition flex items-center gap-2">
                        <i class="fas fa-plus-circle"></i> Nueva Consulta Directa
                    </button>
                </div>
                
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            `;

            if (fila.length === 0) {
                htmlMedico += `<div class="col-span-2 text-center py-12 text-slate-400 font-medium">No hay pacientes en espera en este momento.</div>`;
            } else {
                fila.forEach(paciente => {
                    htmlMedico += `
                        <div class="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm border-l-4 border-${paciente.colorPrioridad}-500 hover:shadow-md transition">
                            <div class="flex justify-between items-start mb-4">
                                <div>
                                    <h3 class="text-xl font-bold text-slate-900">${paciente.nombre}</h3>
                                    <p class="text-sm text-slate-500">${paciente.edad} Años • <i class="fas fa-clock ml-1 mr-1"></i> Esperando: ${paciente.tiempoEspera}</p>
                                </div>
                                <span class="bg-${paciente.colorPrioridad}-50 text-${paciente.colorPrioridad}-700 text-[10px] font-bold uppercase px-2 py-1 rounded border border-${paciente.colorPrioridad}-200">
                                    Triage
                                </span>
                            </div>
                            
                            <p class="text-sm font-semibold text-slate-700 mb-4 bg-slate-50 p-3 rounded-lg border border-slate-100">
                                <span class="text-xs text-slate-400 block uppercase mb-1">Motivo:</span>
                                ${paciente.motivo}
                            </p>

                            <div class="flex justify-between items-center border-t border-slate-100 pt-4 mt-4">
                                <div class="text-[10px] text-slate-400">
                                    <strong>TA:</strong> ${paciente.signos.ta} | <strong>FC:</strong> ${paciente.signos.fc} <br>
                                    Enviado por: ${paciente.enfermera}
                                </div>
                                <a href="expediente.html" class="bg-slate-900 hover:bg-slate-800 text-white px-6 py-2.5 rounded-lg text-sm font-bold shadow-sm transition">
                                    Atender Paciente
                                </a>
                            </div>
                        </div>
                    `;
                });
            }
            
            htmlMedico += `</div>`;
            grid.innerHTML = htmlMedico;
            return; // Detenemos la función para que no cargue lo del Admin
        }

        // ==========================================================
        // 2. VISTA EXCLUSIVA PARA ENFERMERÍA
        // ==========================================================
        if(this.rolActual === 'enfermeria') {
            grid.innerHTML = `
                <div class="flex flex-col items-center justify-center py-20 text-center bg-white rounded-3xl border border-slate-200 shadow-sm">
                    <i class="fas fa-user-nurse text-6xl text-cyan-200 mb-6"></i>
                    <h2 class="text-2xl font-bold text-slate-800 mb-2">Estación de Enfermería Activa</h2>
                    <p class="text-slate-500 mb-8 max-w-md">Utilice el panel lateral para navegar, o presione el botón para abrir el Triage rápido de urgencias.</p>
                    <a href="triage.html" class="bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-3 px-8 rounded-xl shadow-lg transition flex items-center gap-2">
                        <i class="fas fa-clipboard-list"></i> Abrir Triage de Pacientes
                    </a>
                </div>
            `;
            return;
        }

        // ==========================================================
        // 3. VISTA EXCLUSIVA PARA ALFONSO (ADMIN CENTRAL)
        // ==========================================================
        const [pacientes, cirugias, consultorios] = await Promise.all([
            AdminAPI.obtenerPacientesActivos(),
            AdminAPI.obtenerCirugiasProgramadas(),
            AdminAPI.obtenerEstadoConsultorios()
        ]);

        let htmlAdmin = `<div class="grid grid-cols-1 lg:grid-cols-12 gap-6">`;
        
        // COLUMNA IZQUIERDA ADMIN
        htmlAdmin += `<div class="lg:col-span-7 flex flex-col gap-4">
            <h3 class="text-lg font-bold text-slate-800 flex items-center gap-2">
                <i class="fas fa-procedures text-cyan-600"></i> Pacientes Activos
            </h3>`;
        pacientes.forEach(p => {
            htmlAdmin += `
                <div class="bg-white/80 p-5 rounded-2xl shadow-sm border-l-4 border-${p.colorArea}-500 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-slate-200">
                    <div>
                        <div class="flex items-center gap-2 mb-1">
                            <span class="text-[10px] font-bold uppercase tracking-wider bg-${p.colorArea}-100 text-${p.colorArea}-700 px-2 py-0.5 rounded">${p.area}</span>
                        </div>
                        <h4 class="text-lg font-extrabold text-slate-900">${p.nombre}</h4>
                        <p class="text-sm text-slate-600 font-medium">${p.servicio} • <span class="text-slate-500">${p.medico}</span></p>
                    </div>
                    <button onclick="alert('PRE-CUENTA DE ${p.nombre}: $${p.cuentaActual}')" class="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold py-2 px-4 rounded-xl transition">
                        <i class="fas fa-receipt mr-1"></i> Cuenta Rápida
                    </button>
                </div>
            `;
        });
        htmlAdmin += `</div>`;

        // COLUMNA DERECHA ADMIN
        htmlAdmin += `<div class="lg:col-span-5 flex flex-col gap-6">
            <div class="bg-white/80 p-5 rounded-2xl shadow-sm border border-slate-200">
                <h3 class="text-sm font-bold text-slate-800 uppercase tracking-wide mb-3 flex items-center gap-2">
                    <i class="fas fa-scalpel text-cyan-600"></i> Próximas Cirugías
                </h3>
                <div class="flex flex-col gap-3">
        `;
        cirugias.forEach((c) => {
            htmlAdmin += `
                <div class="${c.bgEtiqueta} border-l-4 ${c.colorEtiqueta} rounded-r-xl p-3">
                    <h4 class="font-bold text-slate-900 text-sm">${c.paciente}</h4>
                    <p class="text-xs text-slate-600 font-medium">${c.procedimiento}</p>
                    <div class="bg-yellow-100/50 p-2 rounded border border-yellow-200 mt-2">
                        <p class="text-[10px] font-bold text-yellow-700 uppercase mb-1 flex items-center gap-1"><i class="fas fa-lock"></i> Notas Privadas</p>
                        <p class="text-xs text-slate-800 italic">${c.notasAlfonso}</p>
                    </div>
                </div>
            `;
        });
        htmlAdmin += `</div></div></div></div>`; // Cierra el grid del admin
        
        grid.innerHTML = htmlAdmin;
    }
};

document.addEventListener('DOMContentLoaded', () => AdminController.init());