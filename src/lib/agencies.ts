// D:\Proyectos\power-bi-web_backend\src\lib\agencies.ts

export const AGENCY_NAMES: Record<string, string> = {
  "01": "Wanchaq",
  "02": "San Jerónimo",
  "03": "Quillabamba",
  "04": "Sicuani",
  "05": "Molino",
  "06": "Juliaca",
  "07": "Lima Los Olivos",
  "08": "Tica Tica",
  "09": "Magisterio",
  "10": "Lima SJL",
  "11": "Chiclayo",
  "12": "Arequipa",
  "13": "Pucallpa",
  "98": "Agencia Digital (98)",
};

const normalizeText = (val: string) =>
  val
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

export const NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(AGENCY_NAMES).map(([code, name]) => [normalizeText(name), code])
);

export function getAgencyName(code: any, fallbackPrefix = "Otra Agencia"): string {
  const clean = resolveAgencyCode(code);
  return AGENCY_NAMES[clean] || `${fallbackPrefix}`;
}

export function resolveAgencyCode(agenciaParam: any): string {
  const raw = String(agenciaParam ?? "").split(",")[0].trim();
  const norm = normalizeText(raw);
  if (
    !raw ||
    ["todas", "todas las agencias", "null", "undefined", "all"].includes(norm)
  ) {
    return "";
  }
  if (NAME_TO_CODE[norm]) return NAME_TO_CODE[norm];
  if (norm === "oficina principal" || norm === "principal") return "01";

  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return "";
  const code = digits.padStart(2, "0").slice(-2);
  return AGENCY_NAMES[code] ? code : "";
}

export function sqlCaseAgencia(colExpr: string): string {
  return `
    CASE ${colExpr}
      WHEN '01' THEN 'Wanchaq'
      WHEN '02' THEN 'San Jerónimo'
      WHEN '03' THEN 'Quillabamba'
      WHEN '04' THEN 'Sicuani'
      WHEN '05' THEN 'Molino'
      WHEN '06' THEN 'Juliaca'
      WHEN '07' THEN 'Lima Los Olivos'
      WHEN '08' THEN 'Tica Tica'
      WHEN '09' THEN 'Magisterio'
      WHEN '10' THEN 'Lima SJL'
      WHEN '11' THEN 'Chiclayo'
      WHEN '12' THEN 'Arequipa'
      WHEN '13' THEN 'Pucallpa'
      ELSE 'Otra Agencia'
    END
  `;
}