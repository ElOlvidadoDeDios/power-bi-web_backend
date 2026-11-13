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

export const NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(AGENCY_NAMES).map(([code, name]) => [name.toLowerCase(), code])
);

export function getAgencyName(code: any, fallbackPrefix = "Otra Agencia"): string {
  const clean = String(code || "").trim().padStart(2, "0");
  return AGENCY_NAMES[clean] || `${fallbackPrefix}`;
}

export function resolveAgencyCode(agenciaParam: any): string {
  const raw = String(agenciaParam || "").trim();
  if (!raw || raw === "Todas" || raw === "Todas las Agencias") return "";
  return NAME_TO_CODE[raw.toLowerCase()] || raw.padStart(2, "0");
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