// Identidade desta instância do cache: as leases gravam quem as abriu, e a quota precisa saber
// se um Git pendente é deste processo (monitor vivo, reserva coberta) ou de outro.
import { randomUUID } from 'node:crypto';

const INSTANCE = randomUUID();
export { INSTANCE };
