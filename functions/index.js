const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

// --- CONFIGURACIÓN ---
const VERIFY_TOKEN = "4831600lu"; // Tu contraseña del webhook

// ⚠️ ¡ATENCIÓN! PEGA TU TOKEN DE FACEBOOK AQUÍ ABAJO
const WHATSAPP_TOKEN = "EAAVr0umDY0MBQMMJ5ObxyulztcZA4d8UxSHVxZB2SWuYBZAarzCjkOJNeEUGEmvnOW0jTEuQUZBwfwKh18QeHOTChFS0K17UN1N0KSxETIJRKsMZAJ3LT07DDI3QyAojzVgjuH7rxpcIHYzCZASroTfSZBhuZCV7EOK0N1UNaNlWFNgP86a81kmnHAHxfht96wZDZD"; 

// --- PARCHE ARGENTINA ---
const NUMERO_WHITELIST_FB = "54221156219621"; 

// --- EXPRESIONES REGULARES (VALIDADORES) ---
const REGEX_FECHA = /^(\d{2})-(\d{2})-(\d{4})$/; // DD-MM-AAAA
const REGEX_HORA = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/; // HH:MM (00:00 a 23:59)

exports.whatsappWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method === "GET") {
    if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN) {
      res.status(200).send(req.query["hub.challenge"]);
    } else {
      res.sendStatus(403);
    }
    return;
  }

  if (req.method === "POST") {
    const body = req.body;

    if (body.object === "whatsapp_business_account") {
      try {
        const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

        if (message) {
            const messageId = body.entry[0].changes[0].value.metadata.phone_number_id;
            const textRecibido = message.text?.body || "";
            const realFrom = message.from; 

            console.log(`Mensaje recibido de: ${realFrom}`);

            // --- 1. LÓGICA DE BÚSQUEDA ---
            const docRef = db.collection('schedules').doc('main');
            const docSnap = await docRef.get();
            let replyTo = NUMERO_WHITELIST_FB || realFrom;

            if (!docSnap.exists) {
                console.log("Error CRÍTICO: No existe schedules/main");
                return res.sendStatus(200);
            }

            const data = docSnap.data();
            const employeesList = data.employees; 

            let datosEmpleado = null;
            let indexEmpleado = null;

            if (employeesList) {
                for (const [key, emp] of Object.entries(employeesList)) {
                    if (emp && emp.celular === realFrom) {
                        datosEmpleado = emp;
                        indexEmpleado = key;
                        break;
                    }
                }
            }

            if (!datosEmpleado) {
                await enviarMensaje(messageId, replyTo, "⛔ No estás registrado en la nómina. Contacta a RRHH.");
                return res.sendStatus(200);
            }

            const nombreEmpleado = datosEmpleado.displayName || datosEmpleado.name || "Compañero";

            // --- 2. GESTIÓN DE ESTADO ---
            const estadoRef = db.collection('conversaciones').doc(realFrom);
            const estadoDoc = await estadoRef.get();
            let estadoData = estadoDoc.exists ? estadoDoc.data() : { paso: 'INICIO' };
            let respuesta = "";

            // CANCELAR
            if (textRecibido.toLowerCase() === "cancelar") {
                await estadoRef.delete();
                await enviarMensaje(messageId, replyTo, "❌ Operación cancelada.");
                return res.sendStatus(200);
            }

            switch (estadoData.paso) {
                case 'INICIO':
                    if (textRecibido.toLowerCase().match(/(licencia|dia|día|permiso|falta)/)) {
                        respuesta = `Hola ${nombreEmpleado} 👋. ¿Qué tipo de solicitud es?\n\n1️⃣ Día completo\n2️⃣ Horario parcial\n\n(Responde 1 o 2)`;
                        await estadoRef.set({ paso: 'ESPERANDO_TIPO', datos: {} });
                    } else {
                        respuesta = `Hola ${nombreEmpleado}, soy el bot de RRHH.\nEscribe *'pedir licencia'* para empezar.`;
                    }
                    break;

                case 'ESPERANDO_TIPO':
                    let tipo = "";
                    if (textRecibido.includes("1") || textRecibido.toLowerCase().includes("completo")) tipo = "Día Completo";
                    else if (textRecibido.includes("2") || textRecibido.toLowerCase().includes("parcial")) tipo = "Horario Parcial";
                    
                    if (tipo) {
                        // Mensaje diferente según tipo
                        respuesta = "📅 Ingresa la fecha en formato *DD-MM-AAAA* (Ej: 25-11-2025).";
                        await estadoRef.update({ paso: 'ESPERANDO_FECHA', 'datos.tipo': tipo });
                    } else {
                        respuesta = "⚠️ Responde 1 o 2.";
                    }
                    break;

                case 'ESPERANDO_FECHA':
                    // VALIDACIÓN ESTRICTA DE FECHA
                    if (REGEX_FECHA.test(textRecibido)) {
                        // Convertimos de DD-MM-AAAA a YYYY-MM-DD
                        const [dia, mes, anio] = textRecibido.split('-');
                        const fechaFormateada = `${anio}-${mes}-${dia}`; // Formato ISO para DB

                        // Si es día completo, pasamos a Motivo. Si es Parcial, pedimos hora.
                        if (estadoData.datos.tipo === "Día Completo") {
                            respuesta = "¿Cuál es el motivo? (Ej: Médico, Trámite)";
                            await estadoRef.update({ 
                                paso: 'ESPERANDO_MOTIVO', 
                                'datos.fecha': fechaFormateada,
                                'datos.start': null, // Día completo no tiene hora
                                'datos.end': null
                            });
                        } else {
                            respuesta = "⏰ Ingresa la *Hora de Inicio* en formato *HH:MM* (Ej: 09:00 o 14:30)";
                            await estadoRef.update({ 
                                paso: 'ESPERANDO_HORA_INICIO', 
                                'datos.fecha': fechaFormateada 
                            });
                        }
                    } else {
                        respuesta = "❌ *Formato incorrecto.*\nPor favor ingresa la fecha así: *DD-MM-AAAA*\n\nEjemplo: 25-11-2025";
                    }
                    break;

                case 'ESPERANDO_HORA_INICIO':
                    if (REGEX_HORA.test(textRecibido)) {
                        respuesta = "⏰ Ahora ingresa la *Hora de Fin* en formato *HH:MM* (Ej: 18:00)";
                        await estadoRef.update({ 
                            paso: 'ESPERANDO_HORA_FIN', 
                            'datos.start': textRecibido 
                        });
                    } else {
                        respuesta = "❌ *Hora incorrecta.*\nDebe ser en formato *HH:MM* (Ej: 09:30). Intenta de nuevo.";
                    }
                    break;

                case 'ESPERANDO_HORA_FIN':
                    if (REGEX_HORA.test(textRecibido)) {
                        respuesta = "¿Cuál es el motivo? (Ej: Médico, Trámite)";
                        await estadoRef.update({ 
                            paso: 'ESPERANDO_MOTIVO', 
                            'datos.end': textRecibido 
                        });
                    } else {
                        respuesta = "❌ *Hora incorrecta.*\nDebe ser en formato *HH:MM* (Ej: 18:00).";
                    }
                    break;

                case 'ESPERANDO_MOTIVO':
                    const datos = estadoData.datos; 
                    let detalleHorario = (datos.tipo === "Día Completo") ? "Todo el día" : `${datos.start} a ${datos.end}`;
                    
                    respuesta = `📝 *Confirma tu solicitud:*\n\n👤 ${nombreEmpleado}\n📌 ${datos.tipo}\n📅 ${datos.fecha}\n⏰ ${detalleHorario}\n💬 ${textRecibido}\n\nResponde *SÍ* para enviar o *CANCELAR* para corregir.`;
                    
                    await estadoRef.update({ 
                        paso: 'ESPERANDO_CONFIRMACION', 
                        'datos.motivo': textRecibido 
                    });
                    break;

                case 'ESPERANDO_CONFIRMACION':
                    if (textRecibido.toLowerCase().match(/(si|sí|ok)/)) {
                        // GUARDAMOS EN 'SOLICITUDES'
                        await db.collection('solicitudes').add({
                            empleadoIndex: indexEmpleado,
                            empleadoUid: datosEmpleado.id || "sin-uid",
                            nombre: nombreEmpleado,
                            celular: realFrom,
                            tipo: estadoData.datos.tipo,
                            fechaSolicitada: estadoData.datos.fecha, // Ahora es YYYY-MM-DD
                            start: estadoData.datos.start || null,
                            end: estadoData.datos.end || null,
                            motivo: estadoData.datos.motivo,
                            estado: 'pendiente_aprobacion',
                            fechaCreacion: admin.firestore.FieldValue.serverTimestamp()
                        });

                        respuesta = "✅ Solicitud enviada a RRHH. Te avisaré cuando se apruebe.";
                        await estadoRef.delete(); 
                    } else {
                        respuesta = "Responde SÍ para enviar o CANCELAR para borrar.";
                    }
                    break;
            }

            await enviarMensaje(messageId, replyTo, respuesta);
        }
        res.sendStatus(200);
      } catch (error) {
        console.error("Error:", error);
        res.sendStatus(500);
      }
    } else {
      res.sendStatus(404);
    }
  }
});

async function enviarMensaje(phoneId, to, bodyText) {
    const url = `https://graph.facebook.com/v21.0/${phoneId}/messages`;
    const data = { messaging_product: "whatsapp", to: to, text: { body: bodyText } };
    try {
        await fetch(url, {
            method: "POST",
            headers: { "Authorization": `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify(data)
        });
    } catch (error) {
        console.error("Error envío:", error);
    }
}