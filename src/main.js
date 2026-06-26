// ═══════════════════════════════════════════════════════════════════════
// Vite entry point
// Supabase fonksiyonlarını global (window) scope'a açar.
// HTML'deki inline onclick/kod bloklarının erişebilmesi için gerekli.
// ═══════════════════════════════════════════════════════════════════════
import * as XLSX from 'xlsx'
import {
  sbLoginUser,
  sbGetUserByUsername,
  sbGetAllUsers,
  sbCreateUser,
  sbUpdateUser,
  sbDeleteUser,
} from './supabase.js'

// xlsx global
window.XLSX = XLSX

// HTML inline kodunun window üzerinden erişmesi için global olarak ata
window.sbLoginUser        = sbLoginUser
window.sbGetUserByUsername = sbGetUserByUsername
window.sbGetAllUsers      = sbGetAllUsers
window.sbCreateUser       = sbCreateUser
window.sbUpdateUser       = sbUpdateUser
window.sbDeleteUser       = sbDeleteUser
