// D:\Proyectos\power-bi-web_backend\src\routes\traspasosRecuperacion.ts
import { Router, Request, Response } from "express";
import sql from "mssql";
import { pool } from "../lib/db";
import { AGENCY_NAMES, resolveAgencyCode } from "../lib/agencies";

const router = Router();

let tableEnsured = false;
async function ensureTraspasosTable() {
  if (tableEnsured) return;
  await pool.request().query(`
    IF OBJECT_ID('[DWH_Gestion_Cartera].[dbo].[fct_traspasos_recuperacion]', 'U') IS NULL
    BEGIN
      CREATE TABLE [DWH_Gestion_Cartera].[dbo].[fct_traspasos_recuperacion] (
        [Periodo] VARCHAR(6) NOT NULL,
        [Periodo_Origen] VARCHAR(6) NOT NULL,
        [IdSAgencia] VARCHAR(2) NOT NULL,
        [Cuenta] VARCHAR(20) NOT NULL,
        [Pagare] VARCHAR(40) NOT NULL,
        [Dni] VARCHAR(20) NULL,
        [Socio] NVARCHAR(200) NULL,
        [Producto] VARCHAR(100) NULL,
        [Fecha_Desembolso] DATE NULL,
        [Monto_Desembolsado] DECIMAL(18, 2) NOT NULL DEFAULT 0,
        [Cuota_Mensual] DECIMAL(18, 2) NOT NULL DEFAULT 0,
        [IdSAsesor_Origen] VARCHAR(30) NOT NULL,
        [Analista_Origen] VARCHAR(150) NULL,
        [Cargo_Origen] VARCHAR(80) NULL,
        [Saldo_Origen] DECIMAL(18, 2) NOT NULL DEFAULT 0,
        [Dias_Atraso_Origen] INT NOT NULL DEFAULT 0,
        [Cuotas_Atrasadas_Origen] INT NOT NULL DEFAULT 0,
        [IdSAsesor_Destino] VARCHAR(30) NOT NULL,
        [Analista_Destino] VARCHAR(150) NULL,
        [Cargo_Destino] VARCHAR(80) NULL,
        [Saldo_Actual] DECIMAL(18, 2) NOT NULL DEFAULT 0,
        [Saldo_Vencido_Actual] DECIMAL(18, 2) NOT NULL DEFAULT 0,
        [Cuotas_Atrasadas_Actual] INT NOT NULL DEFAULT 0,
        [Dias_Atraso_Actual] INT NOT NULL DEFAULT 0,
        [Telefonos] VARCHAR(150) NULL,
        [Fecha_Actualizacion] DATETIME NOT NULL DEFAULT GETDATE()
      );
    END
  `);
  tableEnsured = true;
}

router.get(
  ["/traspasos-recuperacion", "/api/traspasos-recuperacion"],
  async (req: Request, res: Response) => {
    try {
      await ensureTraspasosTable();

      const d = new Date();
      const defaultPer = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
      const periodo = String(req.query.periodo || defaultPer)
        .replace(/[^0-9]/g, "")
        .slice(0, 6) || defaultPer;
      const agenciaParam = String(req.query.agencia || "Todas").trim();
      const asesorOrigenParam = String(req.query.asesorOrigen || "Todos").trim();
      const recuperadorParam = String(req.query.recuperador || "Todos").trim();
      const searchParam = String(req.query.search || "").trim().slice(0, 150);

      const page = Math.max(parseInt(req.query.page as string, 10) || 1, 1);
      const limit = Math.max(parseInt(req.query.limit as string, 10) || 100, 1);
      const offset = (page - 1) * limit;

      const resolvedAge = resolveAgencyCode(agenciaParam);
      const codAgencia = /^\d{2}$/.test(resolvedAge) ? resolvedAge : "";

      const asesorOrigen =
        asesorOrigenParam === "Todos" || asesorOrigenParam === "Todas"
          ? ""
          : asesorOrigenParam.slice(0, 150);
      const recuperador =
        recuperadorParam === "Todos" || recuperadorParam === "Todas"
          ? ""
          : recuperadorParam.slice(0, 150);

      const request = pool.request();
      request.input("periodo", sql.VarChar(6), periodo);
      request.input("agencia", sql.VarChar(2), codAgencia);
      request.input("asesorOrigen", sql.VarChar(150), asesorOrigen);
      request.input("recuperador", sql.VarChar(150), recuperador);
      request.input("search", sql.VarChar(150), searchParam);
      request.input("offset", sql.Int, offset);
      request.input("limit", sql.Int, limit);

      const whereClause = `
        WHERE T.[Periodo] = @periodo
          AND (@agencia = '' OR RIGHT('00' + LTRIM(RTRIM(T.[IdSAgencia])), 2) = @agencia)
          AND (
            @asesorOrigen = ''
            OR LTRIM(RTRIM(T.[IdSAsesor_Origen])) = @asesorOrigen
            OR LTRIM(RTRIM(T.[Analista_Origen])) = @asesorOrigen
          )
          AND (
            @recuperador = ''
            OR LTRIM(RTRIM(T.[IdSAsesor_Destino])) = @recuperador
            OR LTRIM(RTRIM(T.[Analista_Destino])) = @recuperador
          )
          AND (
            @search = ''
            OR T.[Socio] LIKE '%' + @search + '%'
            OR T.[Pagare] LIKE '%' + @search + '%'
            OR T.[Cuenta] LIKE '%' + @search + '%'
            OR ISNULL(T.[Dni], '') LIKE '%' + @search + '%'
            OR T.[Analista_Origen] LIKE '%' + @search + '%'
            OR T.[Analista_Destino] LIKE '%' + @search + '%'
          )
      `;

      if (page === 1) {
        const result = await request.query(`
          -- 1. KPIs Globales
          SELECT
            COUNT(DISTINCT T.[Cuenta]) AS totalSocios,
            COUNT(T.[Pagare]) AS totalCreditos,
            ISNULL(SUM(T.[Saldo_Origen]), 0) AS saldoTransferido,
            ISNULL(SUM(T.[Saldo_Actual]), 0) AS saldoActual,
            ISNULL(SUM(T.[Saldo_Origen] - T.[Saldo_Actual]), 0) AS capitalRecuperado,
            ISNULL(AVG(CAST(T.[Dias_Atraso_Origen] AS FLOAT)), 0) AS promDiasOrigen,
            ISNULL(AVG(CAST(T.[Dias_Atraso_Actual] AS FLOAT)), 0) AS promDiasActual
          FROM [DWH_Gestion_Cartera].[dbo].[fct_traspasos_recuperacion] T WITH (NOLOCK)
          ${whereClause};

          -- 2. Matriz Resumen Analista Comercial (Origen) -> Recuperador (Destino)
          SELECT
            RIGHT('00' + LTRIM(RTRIM(T.[IdSAgencia])), 2) AS idAgencia,
            LTRIM(RTRIM(T.[IdSAsesor_Origen])) AS codAnalistaOrigen,
            MAX(LTRIM(RTRIM(ISNULL(T.[Analista_Origen], T.[IdSAsesor_Origen])))) AS analistaOrigen,
            LTRIM(RTRIM(T.[IdSAsesor_Destino])) AS codRecuperadorDestino,
            MAX(LTRIM(RTRIM(ISNULL(T.[Analista_Destino], T.[IdSAsesor_Destino])))) AS recuperadorDestino,
            COUNT(DISTINCT T.[Cuenta]) AS nroSocios,
            COUNT(T.[Pagare]) AS nroCreditos,
            ISNULL(SUM(T.[Saldo_Origen]), 0) AS saldoTransferido,
            ISNULL(SUM(T.[Saldo_Actual]), 0) AS saldoActual,
            ISNULL(SUM(T.[Saldo_Origen] - T.[Saldo_Actual]), 0) AS capitalRecuperado,
            ISNULL(AVG(CAST(T.[Dias_Atraso_Origen] AS FLOAT)), 0) AS promDiasOrigen,
            ISNULL(AVG(CAST(T.[Dias_Atraso_Actual] AS FLOAT)), 0) AS promDiasActual
          FROM [DWH_Gestion_Cartera].[dbo].[fct_traspasos_recuperacion] T WITH (NOLOCK)
          ${whereClause}
          GROUP BY
            RIGHT('00' + LTRIM(RTRIM(T.[IdSAgencia])), 2),
            LTRIM(RTRIM(T.[IdSAsesor_Origen])),
            LTRIM(RTRIM(T.[IdSAsesor_Destino]))
          ORDER BY COUNT(DISTINCT T.[Cuenta]) DESC, SUM(T.[Saldo_Actual]) DESC;

          -- 3. Detalle Paginado de Créditos (Scroll Infinito)
          SELECT
            T.[Periodo] AS periodo,
            T.[Periodo_Origen] AS periodoOrigen,
            RIGHT('00' + LTRIM(RTRIM(T.[IdSAgencia])), 2) AS idAgencia,
            RIGHT('000000000000' + LTRIM(RTRIM(T.[Cuenta])), 12) AS cuenta,
            LTRIM(RTRIM(T.[Pagare])) AS pagare,
            LTRIM(RTRIM(ISNULL(T.[Dni], ''))) AS dni,
            LTRIM(RTRIM(ISNULL(T.[Socio], ''))) AS socio,
            LTRIM(RTRIM(ISNULL(T.[Producto], ''))) AS producto,
            CASE WHEN T.[Fecha_Desembolso] IS NOT NULL THEN CONVERT(VARCHAR(10), T.[Fecha_Desembolso], 103) ELSE '' END AS fechaDesembolso,
            ISNULL(T.[Monto_Desembolsado], 0) AS montoDesembolsado,
            ISNULL(T.[Cuota_Mensual], 0) AS cuotaMensual,
            LTRIM(RTRIM(T.[IdSAsesor_Origen])) AS codAnalistaOrigen,
            LTRIM(RTRIM(ISNULL(T.[Analista_Origen], T.[IdSAsesor_Origen]))) AS analistaOrigen,
            ISNULL(T.[Saldo_Origen], 0) AS saldoOrigen,
            ISNULL(T.[Dias_Atraso_Origen], 0) AS diasAtrasoOrigen,
            ISNULL(T.[Cuotas_Atrasadas_Origen], 0) AS cuotasAtrasadasOrigen,
            LTRIM(RTRIM(T.[IdSAsesor_Destino])) AS codRecuperadorDestino,
            LTRIM(RTRIM(ISNULL(T.[Analista_Destino], T.[IdSAsesor_Destino]))) AS recuperadorDestino,
            ISNULL(T.[Saldo_Actual], 0) AS saldoActual,
            ISNULL(T.[Saldo_Origen] - T.[Saldo_Actual], 0) AS capitalAmortizado,
            ISNULL(T.[Saldo_Vencido_Actual], 0) AS saldoVencidoActual,
            ISNULL(T.[Cuotas_Atrasadas_Actual], 0) AS cuotasAtrasadasActual,
            ISNULL(T.[Dias_Atraso_Actual], 0) AS diasAtrasoActual,
            ISNULL(T.[Telefonos], '') AS telefonos,
            COUNT(*) OVER() AS TotalRegistrosGlobal
          FROM [DWH_Gestion_Cartera].[dbo].[fct_traspasos_recuperacion] T WITH (NOLOCK)
          ${whereClause}
          ORDER BY T.[Saldo_Actual] DESC, T.[Pagare] ASC
          OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
        `);

        const sets = result.recordsets as any[];
        const kpiRow = sets[0]?.[0] || {};
        const saldoTrans = Number(kpiRow.saldoTransferido || 0);
        const capRecup = Number(kpiRow.capitalRecuperado || 0);

        const resumenAnalistas = (sets[1] || []).map((r: any) => {
          const st = Number(r.saldoTransferido || 0);
          const cr = Number(r.capitalRecuperado || 0);
          return {
            ...r,
            agencia: AGENCY_NAMES[r.idAgencia] || `Agencia ${r.idAgencia}`,
            nroSocios: Number(r.nroSocios || 0),
            nroCreditos: Number(r.nroCreditos || 0),
            saldoTransferido: st,
            saldoActual: Number(r.saldoActual || 0),
            capitalRecuperado: cr,
            pctRecuperado: st > 0 ? Number(((cr / st) * 100).toFixed(2)) : 0,
            promDiasOrigen: Number(Number(r.promDiasOrigen || 0).toFixed(1)),
            promDiasActual: Number(Number(r.promDiasActual || 0).toFixed(1)),
          };
        });

        const detalle = (sets[2] || []).map((r: any) => ({
          ...r,
          agencia: AGENCY_NAMES[r.idAgencia] || `Agencia ${r.idAgencia}`,
        }));

        return res.json({
          kpis: {
            totalSocios: Number(kpiRow.totalSocios || 0),
            totalCreditos: Number(kpiRow.totalCreditos || 0),
            saldoTransferido: saldoTrans,
            saldoActual: Number(kpiRow.saldoActual || 0),
            capitalRecuperado: capRecup,
            pctRecuperado:
              saldoTrans > 0 ? Number(((capRecup / saldoTrans) * 100).toFixed(2)) : 0,
            promDiasOrigen: Number(Number(kpiRow.promDiasOrigen || 0).toFixed(1)),
            promDiasActual: Number(Number(kpiRow.promDiasActual || 0).toFixed(1)),
          },
          resumenAnalistas,
          detalle,
        });
      }

      const pageRes = await request.query(`
        SELECT
          T.[Periodo] AS periodo,
          T.[Periodo_Origen] AS periodoOrigen,
          RIGHT('00' + LTRIM(RTRIM(T.[IdSAgencia])), 2) AS idAgencia,
          RIGHT('000000000000' + LTRIM(RTRIM(T.[Cuenta])), 12) AS cuenta,
          LTRIM(RTRIM(T.[Pagare])) AS pagare,
          LTRIM(RTRIM(ISNULL(T.[Dni], ''))) AS dni,
          LTRIM(RTRIM(ISNULL(T.[Socio], ''))) AS socio,
          LTRIM(RTRIM(ISNULL(T.[Producto], ''))) AS producto,
          CASE WHEN T.[Fecha_Desembolso] IS NOT NULL THEN CONVERT(VARCHAR(10), T.[Fecha_Desembolso], 103) ELSE '' END AS fechaDesembolso,
          ISNULL(T.[Monto_Desembolsado], 0) AS montoDesembolsado,
          ISNULL(T.[Cuota_Mensual], 0) AS cuotaMensual,
          LTRIM(RTRIM(T.[IdSAsesor_Origen])) AS codAnalistaOrigen,
          LTRIM(RTRIM(ISNULL(T.[Analista_Origen], T.[IdSAsesor_Origen]))) AS analistaOrigen,
          ISNULL(T.[Saldo_Origen], 0) AS saldoOrigen,
          ISNULL(T.[Dias_Atraso_Origen], 0) AS diasAtrasoOrigen,
          ISNULL(T.[Cuotas_Atrasadas_Origen], 0) AS cuotasAtrasadasOrigen,
          LTRIM(RTRIM(T.[IdSAsesor_Destino])) AS codRecuperadorDestino,
          LTRIM(RTRIM(ISNULL(T.[Analista_Destino], T.[IdSAsesor_Destino]))) AS recuperadorDestino,
          ISNULL(T.[Saldo_Actual], 0) AS saldoActual,
          ISNULL(T.[Saldo_Origen] - T.[Saldo_Actual], 0) AS capitalAmortizado,
          ISNULL(T.[Saldo_Vencido_Actual], 0) AS saldoVencidoActual,
          ISNULL(T.[Cuotas_Atrasadas_Actual], 0) AS cuotasAtrasadasActual,
          ISNULL(T.[Dias_Atraso_Actual], 0) AS diasAtrasoActual,
          ISNULL(T.[Telefonos], '') AS telefonos,
          COUNT(*) OVER() AS TotalRegistrosGlobal
        FROM [DWH_Gestion_Cartera].[dbo].[fct_traspasos_recuperacion] T WITH (NOLOCK)
        ${whereClause}
        ORDER BY T.[Saldo_Actual] DESC, T.[Pagare] ASC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
      `);

      const detalle = (pageRes.recordset || []).map((r: any) => ({
        ...r,
        agencia: AGENCY_NAMES[r.idAgencia] || `Agencia ${r.idAgencia}`,
      }));

      res.json({ detalle });
    } catch (error) {
      console.error("Error en /api/traspasos-recuperacion:", error);
      res.status(500).json({ error: "Error obteniendo traspasos a recuperación" });
    }
  }
);

export default router;