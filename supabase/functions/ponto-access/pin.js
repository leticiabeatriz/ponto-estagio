const ITERATIONS = 210000;
const to64 = bytes => btoa(String.fromCharCode(...bytes));
const from64 = text => Uint8Array.from(atob(text), c=>c.charCodeAt(0));
async function derive(pin, salt) {
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveBits']);
  return to64(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:from64(salt),iterations:ITERATIONS},key,256)));
}
export async function createPin(pin) {
  if (!/^\d{4}$/.test(pin)) throw new Error('Escolha um PIN de 4 dígitos.');
  const pin_salt = to64(crypto.getRandomValues(new Uint8Array(16)));
  return {pin_salt,pin_hash:await derive(pin,pin_salt)};
}
export async function verifyPin(pin, profile) {
  if (!/^\d{4}$/.test(pin) || !profile.pin_salt || !profile.pin_hash) return false;
  return await derive(pin,profile.pin_salt) === profile.pin_hash;
}
