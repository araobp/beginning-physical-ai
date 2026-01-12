import { SerialPort } from 'serialport';

const PORT = "/dev/cu.usbmodem1101";  // Arduino UNO port in case of My MacBookAir
const BAUD_RATE = 9600;
const [ON, OFF] = ['1', '0'];

const port = new SerialPort({
    path: PORT,
    baudRate: BAUD_RATE,
});

const write = async (port, cmd) => {
    return new Promise(function (resolve, reject) {
        port.write(cmd, err => {
            if (err) {
                console.error('Error on write: ', err.message);
                reject(err);
            } else {
                console.log('message written')
                resolve(cmd);
            }
        })
    });
}

export async function POST({ url }) {
    const switch_ = url.searchParams.get('switch');

    var cmd;
    if (switch_ == "on") {
        cmd = ON;
    } else if (switch_ == "off") {
        cmd = OFF;
    } else {
        return new Response(JSON.stringify({ message: "Invalid switch value" }), { status: 400 });
    }

    await write(port, cmd);
    return new Response(JSON.stringify({ message: "Message written" }), { status: 200 });
}

setTimeout(() => {
    write(port, OFF);
}, 3000);
