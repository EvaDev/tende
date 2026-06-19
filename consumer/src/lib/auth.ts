import { setToken, getToken } from './api';

export function isLoggedIn() { return !!getToken(); }
export function logout() { setToken(null); }
