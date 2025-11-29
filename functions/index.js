const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const fetch = require("node-fetch");

admin.initializeApp();
const db = admin.firestore();

// --- CONFIGURACIÓN ---
const VERIFY_TOKEN = "4831600lu";

// ⚠️ 1. TU TOKEN PERMANENTE
const WHATSAPP_TOKEN = "EAAVr0umDY0MBQGxtTcff994m4i6S5sjdx2vOYdTJbGFzzUd3pV1a3D0iPLporJogughZA3yZCGj2jmWKf1V1BCzezfCcKjc2BrXX34lbJaSgQZAIKobe3kPtgQI8KxmuZBlH49btiZB2cGZCznlrd5Ar8RQU5Ky1idELKXXrppNldZCawGZAdvIPAGt91XBwIJxnqAZDZD"; 

// ⚠️ 2. TU PHONE ID
const PHONE_ID = "940974942424225"; 

const NUMERO_WHITELIST_FB = null; // Parche desactivado

const REGEX_FECHA = /^(\d{2})-(\d{2})-(\d{4})$/; 
const REGEX_HORA = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/; 
const TIMEOUT_MS = 5 * 60 * 1000; 

// Mapa de días
const MAPA_DIAS = {
    "lunes": 0, "martes": 1, "miercoles": 2, "miércoles": 2, 
    "jueves": 3, "viernes": 4, "sabado": 5, "sábado": 5, "domingo": 6
};

// ==========================================
// 1. WEBHOOK (CEREBRO DEL BOT)
// ==========================================
exports.whatsappWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method === "GET") {
      if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN) {
          res.status(200).send(req.query["hub.challenge"]);
      } else { res.sendStatus(403); }
      return;
  }

  if (req.method === "POST") {
    const body = req.body;
    if (body.object === "whatsapp_business_account") {
      try {
        const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

        if (message) {
            const textRecibido = message.text?.body || "";
            const realFrom = message.from; 
            
            // Usamos parche si existe, si no el real
            let replyTo = NUMERO_WHITELIST_FB || realFrom;

            console.log(`[BOT] Mensaje: ${textRecibido} de ${realFrom}`);

            // A. BUSCAR EMPLEADO
            const employeesRef = db.collection('employees');
            const snapshot = await employeesRef.where('celular', '==', realFrom).limit(1).get();

            if (snapshot.empty) {
                await enviarMensaje(replyTo, "⛔ Tu número no está en nuestro sistema. Contacta con un gerente.");
                return res.sendStatus(200);
            }

            const docEmpleado = snapshot.docs[0];
            const datosEmpleado = docEmpleado.data();
            const nombreEmpleado = datosEmpleado.displayName || datosEmpleado.name || "Compañero";
            const empleadoUid = docEmpleado.id;
            
            // Prioridad: Celular Sandbox (manual) > ReplyTo
            const numeroParaResponder = datosEmpleado.celular_sandbox || replyTo;

            // B. ESTADO Y TIMEOUT
            const estadoRef = db.collection('conversaciones').doc(realFrom);
            const estadoDoc = await estadoRef.get();
            let estadoData = estadoDoc.exists ? estadoDoc.data() : { paso: 'INICIO', lastActive: 0 };
            
            const now = Date.now();
            const lastActive = (estadoData.lastActive && typeof estadoData.lastActive.toMillis === 'function') ? estadoData.lastActive.toMillis() : 0;
            
            if (estadoData.paso !== 'INICIO' && (now - lastActive) > TIMEOUT_MS) {
                const esSaludo = textRecibido.toLowerCase().match(/(dias|días|licencia|permiso|falta|hola|horario|turno|dispo)/);
                if (!esSaludo) {
                    await enviarMensaje(numeroParaResponder, "⏳ Sesión expirada. Comienza de nuevo.");
                    await estadoRef.set({ paso: 'INICIO', lastActive: admin.firestore.FieldValue.serverTimestamp() });
                    return res.sendStatus(200);
                } else { estadoData.paso = 'INICIO'; }
            }

            let respuesta = "";

            if (textRecibido.toLowerCase() === "cancelar") {
                await estadoRef.delete();
                await enviarMensaje(numeroParaResponder, "❌ Operación cancelada.");
                return res.sendStatus(200);
            }

            switch (estadoData.paso) {
                case 'INICIO':
                    const txt = textRecibido.toLowerCase();
                    
                    // OPCIÓN 1: PEDIR DÍAS
                    if (txt.match(/(dias|días|licencia|permiso|falta)/)) {
                        respuesta = `📝 *Solicitud de Ausencia*\n\nSelecciona:\n1️⃣ Pedir día completo\n2️⃣ Pedir NO trabajar en cierto horario\n\n(Responde 1 o 2)`;
                        await estadoRef.set({ paso: 'ESPERANDO_TIPO', datos: {}, lastActive: admin.firestore.FieldValue.serverTimestamp() });
                    } 
                    // OPCIÓN 2: HORARIOS
                    else if (txt.match(/(horario|turno|cuando|cuándo|trabajo)/)) {
                        respuesta = `📅 *Consulta de Horarios*\n¿Qué semana quieres consultar?\n\n1️⃣ Esta semana\n2️⃣ La próxima semana`;
                        await estadoRef.set({ paso: 'ESPERANDO_SEMANA_HORARIO', datos: {}, lastActive: admin.firestore.FieldValue.serverTimestamp() });
                    }
                    // OPCIÓN 3: DISPONIBILIDAD
                    else if (txt.match(/(dispo|disponibilidad|cambiar)/)) {
                        respuesta = `🔄 *Cambio de Disponibilidad Fija*\n\n¿Qué día quieres modificar?\n(Ej: Lunes, Martes...)`;
                        await estadoRef.set({ paso: 'ESPERANDO_DIA_DISPO', datos: {}, lastActive: admin.firestore.FieldValue.serverTimestamp() });
                    }
                    else {
                        respuesta = `Hola ${nombreEmpleado}, soy el asistente de horarios.\n\nEscribe:\n👉 *'Horarios'* para ver tus turnos.\n👉 *'Pedir días'* para ausencias.\n👉 *'Disponibilidad'* para cambios fijos.`;
                    }
                    break;

                // --- FLUJO DISPONIBILIDAD ---
                case 'ESPERANDO_DIA_DISPO':
                    const diaInput = textRecibido.toLowerCase().trim();
                    const diaIndex = MAPA_DIAS[diaInput];

                    if (diaIndex !== undefined) {
                        respuesta = `✅ Has elegido *${diaInput.toUpperCase()}*.\n\n⏰ Escribe tu nueva disponibilidad en formato **HH:MM-HH:MM**.\n\nEjemplos:\n- Corrido: **09:00-18:00**\n- Cortado (usa coma): **11:00-15:00,19:00-23:00**`;
                        await estadoRef.update({ 
                            paso: 'ESPERANDO_NUEVA_DISPO', 
                            'datos.diaNombre': diaInput,
                            'datos.diaIndex': diaIndex,
                            lastActive: admin.firestore.FieldValue.serverTimestamp() 
                        });
                    } else { respuesta = "⚠️ Día no entendido. Escribe Lunes, Martes, etc."; }
                    break;

                case 'ESPERANDO_NUEVA_DISPO':
                    // Validación estricta de rangos HH:MM-HH:MM
                    const rawText = textRecibido.trim();
                    const rangoRegex = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/;
                    const partes = rawText.split(',');
                    let esValido = true;
                    let rangosFormateados = [];

                    for (let parte of partes) {
                        const match = parte.trim().match(rangoRegex);
                        if (match) {
                            const h1 = match[1].padStart(2, '0');
                            const m1 = match[2];
                            const h2 = match[3].padStart(2, '0');
                            const m2 = match[4];
                            if(h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) { esValido = false; break; }
                            rangosFormateados.push(`${h1}:${m1}-${h2}:${m2}`);
                        } else { esValido = false; break; }
                    }

                    if (esValido) {
                        const nuevaDispoFinal = rangosFormateados.join(',');
                        const diaNombre = estadoData.datos.diaNombre;
                        respuesta = `📝 *Confirma solicitud:*\n\n🔄 *Tipo:* Cambio Disponibilidad\n📅 *Día:* ${diaNombre.toUpperCase()}\n⏰ *Nueva:* ${nuevaDispoFinal}\n\nResponde *SÍ* para enviar.`;
                        await estadoRef.update({ 
                            paso: 'CONFIRMAR_DISPO', 
                            'datos.nuevaDispo': nuevaDispoFinal,
                            lastActive: admin.firestore.FieldValue.serverTimestamp() 
                        });
                    } else {
                        respuesta = `❌ *Formato incorrecto.*\nUsa **HH:MM-HH:MM**.\nEj: 09:00-17:00`;
                    }
                    break;

                case 'CONFIRMAR_DISPO':
                    if (textRecibido.toLowerCase().match(/(si|sí|ok)/)) {
                        await db.collection('solicitudes').add({
                            empleadoUid: empleadoUid,
                            nombre: nombreEmpleado,
                            celular: realFrom,
                            celular_sandbox: datosEmpleado.celular_sandbox || null,
                            tipo: 'cambio_disponibilidad',
                            diaIndex: estadoData.datos.diaIndex,
                            diaNombre: estadoData.datos.diaNombre,
                            nuevaDispo: estadoData.datos.nuevaDispo,
                            estado: 'pendiente_aprobacion',
                            fechaCreacion: admin.firestore.FieldValue.serverTimestamp()
                        });
                        respuesta = "✅ Solicitud enviada.";
                        await estadoRef.delete();
                    } else { respuesta = "Responde SÍ o CANCELAR."; }
                    break;

                // --- FLUJO HORARIOS ---
                case 'ESPERANDO_SEMANA_HORARIO':
                    let fechaBase = new Date();
                    fechaBase.setHours(fechaBase.getHours() - 3);
                    if (textRecibido.includes("1") || textRecibido.toLowerCase().includes("esta")) {} 
                    else if (textRecibido.includes("2") || textRecibido.toLowerCase().includes("proxima")) { fechaBase.setDate(fechaBase.getDate() + 7); } 
                    else {
                        respuesta = "⚠️ Opción no válida. Responde 1 o 2.";
                        await enviarMensaje(numeroParaResponder, respuesta);
                        return res.sendStatus(200);
                    }
                    const diff = fechaBase.getDate() - fechaBase.getDay() + (fechaBase.getDay() === 0 ? -6 : 1);
                    const lunes = new Date(fechaBase.setDate(diff));
                    const weekKey = lunes.toISOString().split('T')[0];

                    await enviarMensaje(numeroParaResponder, `🔍 Buscando semana del ${weekKey}...`);
                    const scheduleDoc = await db.collection('schedules').doc('main').get();
                    let turnosEncontrados = false;
                    const [yK, mK, dK] = weekKey.split('-');
                    let reporte = `📅 *Tus Turnos (Semana del ${dK}/${mK})*\n`;

                    if (scheduleDoc.exists) {
                        const allSchedules = scheduleDoc.data().schedules || {};
                        const weekSchedule = allSchedules[weekKey]; 
                        if (weekSchedule) {
                            const diasNombres = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
                            for (let i = 0; i < 7; i++) {
                                const miTurno = (weekSchedule[i] || []).find(s => s.employeeId === empleadoUid);
                                if (miTurno) {
                                    turnosEncontrados = true;
                                    reporte += `\n• *${diasNombres[i]}:* ${slotToTime(miTurno.startSlot)} - ${slotToTime(miTurno.endSlot + 1)}`;
                                }
                            }
                        }
                    }
                    respuesta = turnosEncontrados ? reporte : `📅 *Semana del ${dK}/${mK}*\n\nNo tienes turnos asignados.`;
                    await estadoRef.set({ paso: 'INICIO', lastActive: admin.firestore.FieldValue.serverTimestamp() });
                    break;

                // --- FLUJO PEDIR DÍAS ---
                case 'ESPERANDO_TIPO':
                    let tipo = "";
                    if (textRecibido.includes("1") || textRecibido.toLowerCase().includes("completo")) tipo = "Día Completo";
                    else if (textRecibido.includes("2") || textRecibido.toLowerCase().includes("parcial")) tipo = "Horario Parcial";
                    if (tipo) {
                        respuesta = "📅 Ingresa la fecha (DD-MM-AAAA). Ej: 26-11-2025";
                        await estadoRef.update({ paso: 'ESPERANDO_FECHA', 'datos.tipo': tipo, lastActive: admin.firestore.FieldValue.serverTimestamp() });
                    } else { respuesta = "⚠️ Responde 1 o 2."; }
                    break;

                case 'ESPERANDO_FECHA':
                    if (REGEX_FECHA.test(textRecibido)) {
                        const [d, m, y] = textRecibido.split('-');
                        const fechaISO = `${y}-${m}-${d}`;
                        if (estadoData.datos.tipo === "Día Completo") {
                            respuesta = "Entendido. ¿Cuál es el motivo?";
                            await estadoRef.update({ paso: 'ESPERANDO_MOTIVO', 'datos.fecha': fechaISO, 'datos.start': null, 'datos.end': null, lastActive: admin.firestore.FieldValue.serverTimestamp() });
                        } else {
                            respuesta = "🛑 ¿Desde qué hora **NO** puedes trabajar? (Formato HH:MM, ej: 14:00)";
                            await estadoRef.update({ paso: 'ESPERANDO_HORA_INICIO', 'datos.fecha': fechaISO, lastActive: admin.firestore.FieldValue.serverTimestamp() });
                        }
                    } else { respuesta = "❌ Formato incorrecto. Usa DD-MM-AAAA."; }
                    break;

                case 'ESPERANDO_HORA_INICIO':
                    if (REGEX_HORA.test(textRecibido)) {
                        respuesta = "🛑 ¿Hasta qué hora **NO** puedes trabajar? (Formato HH:MM, ej: 18:00)";
                        await estadoRef.update({ paso: 'ESPERANDO_HORA_FIN', 'datos.start': textRecibido, lastActive: admin.firestore.FieldValue.serverTimestamp() });
                    } else { respuesta = "❌ Hora incorrecta (HH:MM)."; }
                    break;

                case 'ESPERANDO_HORA_FIN':
                    if (REGEX_HORA.test(textRecibido)) {
                        respuesta = "¿Cuál es el motivo?";
                        await estadoRef.update({ paso: 'ESPERANDO_MOTIVO', 'datos.end': textRecibido, lastActive: admin.firestore.FieldValue.serverTimestamp() });
                    } else { respuesta = "❌ Hora incorrecta (HH:MM)."; }
                    break;

                case 'ESPERANDO_MOTIVO':
                    const d = estadoData.datos; 
                    let detalleH = (d.tipo === "Día Completo") ? "Todo el día" : `${d.start} a ${d.end}`;
                    const [y, m, dia] = d.fecha.split('-');
                    let tipoT = d.tipo === "Día Completo" ? "Día Completo" : "No trabajar en horario parcial";
                    respuesta = `📝 *Confirma solicitud:*\n\n📌 ${tipoT}\n📅 ${dia}-${m}-${y}\n⏰ No disponible: ${detalleH}\n💬 ${textRecibido}\n\nResponde *SÍ* para enviar.`;
                    await estadoRef.update({ paso: 'ESPERANDO_CONFIRMACION', 'datos.motivo': textRecibido, lastActive: admin.firestore.FieldValue.serverTimestamp() });
                    break;

                case 'ESPERANDO_CONFIRMACION':
                    if (textRecibido.toLowerCase().match(/(si|sí|ok)/)) {
                        await db.collection('solicitudes').add({
                            empleadoUid: empleadoUid,
                            nombre: nombreEmpleado,
                            celular: realFrom,
                            celular_sandbox: datosEmpleado.celular_sandbox || null,
                            tipo: estadoData.datos.tipo,
                            fechaSolicitada: estadoData.datos.fecha,
                            start: estadoData.datos.start || null,
                            end: estadoData.datos.end || null,
                            motivo: estadoData.datos.motivo,
                            estado: 'pendiente_aprobacion',
                            fechaCreacion: admin.firestore.FieldValue.serverTimestamp()
                        });
                        respuesta = "✅ Solicitud enviada.";
                        await estadoRef.delete(); 
                    } else { respuesta = "Responde SÍ o CANCELAR."; }
                    break;
            }

            await enviarMensaje(numeroParaResponder, respuesta);
        }
        res.sendStatus(200);
      } catch (error) { console.error("[CRASH]", error); res.sendStatus(500); }
    } else { res.sendStatus(404); }
  }
});

// ==========================================
// 2. NOTIFICADOR (TRIGGER)
// ==========================================
exports.notificarCambioEstado = onDocumentUpdated("solicitudes/{solicitudId}", async (event) => {
    const now = event.data.after.data();
    const before = event.data.before.data();
    if (!now || now.estado === before.estado) return null;

    const nombre = now.nombre;
    const num = now.celular_sandbox || now.celular;
    let msg = "";

    if (now.tipo === 'cambio_disponibilidad') {
        if (now.estado === 'aprobada') msg = `✅ *Cambio de Disponibilidad Aprobado*\nHola ${nombre}, se ha actualizado tu disponibilidad para los ${now.diaNombre.toUpperCase()}.`;
        else if (now.estado === 'rechazada') msg = `❌ *Cambio Rechazado*\nHola ${nombre}, tu cambio para ${now.diaNombre} no fue aprobado.\nMotivo: ${now.motivoRechazo || "-"}`;
    } else {
        const [y, m, d] = now.fechaSolicitada.split('-');
        const fechaVisual = `${d}-${m}-${y}`;
        let det = now.start && now.end ? ` (${now.start} a ${now.end})` : "";
        if (now.estado === 'aprobada') msg = `✅ *Solicitud Aprobada*\nHola ${nombre}, tu licencia para el día ${fechaVisual}${det} ha sido confirmada.`;
        else if (now.estado === 'rechazada') msg = `❌ *Solicitud Rechazada*\nHola ${nombre}, tu solicitud para el día ${fechaVisual} no fue aprobada.\nMotivo: ${now.motivoRechazo || "-"}`;
    }

    if (msg) await enviarMensaje(num, msg);
    return null;
});

// --- HELPERS ---
function slotToTime(slot) {
    if (slot === null || slot === undefined) return "??:??";
    const HORA_INICIO_GRILLA = 6; 
    const totalMinutos = (HORA_INICIO_GRILLA * 60) + (slot * 30);
    const hours = Math.floor(totalMinutos / 60) % 24; 
    const mins = totalMinutos % 60;
    const hStr = hours.toString().padStart(2, '0');
    const mStr = mins.toString().padStart(2, '0');
    return `${hStr}:${mStr}`;
}

async function enviarMensaje(to, bodyText) {
    let finalTo = to;
    
    // AUTO-FIX ARGENTINA (Sandbox)
    if (to.startsWith("549")) {
        const resto = to.substring(3); 
        let area = "", num = "";
        
        if (resto.startsWith("11")) { area = "11"; num = resto.substring(2); } 
        else if (resto.startsWith("2245")) { area = "2245"; num = resto.substring(4); } 
        else { area = resto.substring(0, 3); num = resto.substring(3); }
        
        finalTo = "54" + area + "15" + num;
        console.log(`[AUTO-FIX] Transformado a: ${finalTo}`);
    }

    const url = `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`;
    const data = { messaging_product: "whatsapp", to: finalTo, text: { body: bodyText } };
    try {
        await fetch(url, {
            method: "POST",
            headers: { "Authorization": `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify(data)
        });
    } catch (error) { console.error("Error envío:", error); }
}