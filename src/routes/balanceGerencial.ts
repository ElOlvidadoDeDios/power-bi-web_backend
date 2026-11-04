// src/routes/balanceGerencial.ts
import { Router, Request, Response } from "express";
import sql from "mssql";
import { pool } from "../lib/db";

const router = Router();

const AGENCY_NAMES: Record<string, string> = {
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

// Regla institucional:
// - APORTES (Cuenta Contable 31110101): Tipo_Aho = '01' (101, 102, 103) + ('09','102' AHORRO PRES)
// - EXCLUIDO DE TODOS LOS REPORTES: ('09','101' DESEMBOLSO CREDITO - Cuenta 29180702)
// - AHORROS: Todos los demás subtipos distintos de '03' (DPF) y distintos de Aportes
const esSubtipoAporte = (tipoAho: string, subtipoAho: string): boolean => {
  const t = String(tipoAho || "").trim();
  const s = String(subtipoAho || "").trim();
  return t === "01" || (t === "09" && s === "102");
};

const esSubtipoExcluido = (tipoAho: string, subtipoAho: string): boolean => {
  const t = String(tipoAho || "").trim();
  const s = String(subtipoAho || "").trim();
  return t === "09" && s === "101";
};

// ============================================================================
// GET /api/balance-gerencial
// ============================================================================
router.get(
  ["/balance-gerencial", "/api/balance-gerencial"],
  async (req: Request, res: Response) => {
    try {
      const separar98 = String(req.query.separar98 || "false") === "true";
      const incluirTodoPreec = String(req.query.incluirTodoPreec || "true") === "true";
      const granularidad =
        String(req.query.granularidad || "Mensual") === "Diario" ? "Diario" : "Mensual";
      const agenciaFiltro = String(req.query.agencia || "Todas").trim();
      const asesorFiltro = String(req.query.asesor || "Todos").trim();
      const fechaFiltro = String(req.query.fecha || "CIERRE").trim();

      const rawMoneda = String(req.query.moneda || "MN").toUpperCase().trim();
      const monedaFiltro: "MN" | "ME" | "CONSOLIDADO" =
        rawMoneda === "ME" || rawMoneda === "CONSOLIDADO" ? rawMoneda : "MN";

      const rawTipoCap = String(req.query.tipoCaptacion || "COMBINADO").toUpperCase().trim();
      const tipoCaptacion: "COMBINADO" | "AHORROS" | "APORTES" =
        rawTipoCap === "AHORROS" || rawTipoCap === "APORTES" ? rawTipoCap : "COMBINADO";

      // Condiciones SQL para excluir siempre 09-101 y separar Aportes (01 + 09-102) de Ahorros
      const sqlExcluir09101Stock = `AND NOT (LTRIM(RTRIM(S.[Tipo_Aho])) = '09' AND LTRIM(RTRIM(S.[Subtipo_Aho])) = '101')`;
      const sqlExcluir09101Flujo = `AND NOT (LTRIM(RTRIM([Tipo_Aho])) = '09' AND LTRIM(RTRIM([Subtipo_Aho])) = '101')`;

      const sqlCondAporteStock = `(LTRIM(RTRIM(S.[Tipo_Aho])) = '01' OR (LTRIM(RTRIM(S.[Tipo_Aho])) = '09' AND LTRIM(RTRIM(S.[Subtipo_Aho])) = '102'))`;
      const sqlCondAporteFlujo = `(LTRIM(RTRIM([Tipo_Aho])) = '01' OR (LTRIM(RTRIM([Tipo_Aho])) = '09' AND LTRIM(RTRIM([Subtipo_Aho])) = '102'))`;

      const sqlFiltroCapStock =
        tipoCaptacion === "APORTES"
          ? `WHEN ${sqlCondAporteStock}`
          : tipoCaptacion === "AHORROS"
          ? `WHEN LTRIM(RTRIM(S.[Tipo_Aho])) <> '03' AND NOT ${sqlCondAporteStock}`
          : `WHEN LTRIM(RTRIM(S.[Tipo_Aho])) <> '03'`;

      const sqlFiltroCapFlujo =
        tipoCaptacion === "APORTES"
          ? `WHEN ${sqlCondAporteFlujo}`
          : tipoCaptacion === "AHORROS"
          ? `WHEN LTRIM(RTRIM([Tipo_Aho])) <> '03' AND NOT ${sqlCondAporteFlujo}`
          : `WHEN LTRIM(RTRIM([Tipo_Aho])) <> '03'`;

      // 1. Obtener periodos ejecutados
      const resPeriodos = await pool.request().query(`
        SELECT DISTINCT [Periodo]
        FROM [DWH_Gestion_Cartera].[dbo].[fct_gerencia_ahorros_stock] WITH (NOLOCK)
        WHERE [Periodo] IS NOT NULL
        ORDER BY [Periodo] DESC;
      `);

      const listaPeriodos: string[] = resPeriodos.recordset.map((r: any) =>
        String(r.Periodo).trim()
      );
      const d = new Date();
      const periodoDefault = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
      const periodo = String(req.query.periodo || listaPeriodos[0] || periodoDefault).trim();

      // 2. Obtener fechas disponibles dentro del periodo seleccionado
      const reqFechas = pool.request();
      reqFechas.input("periodo", sql.VarChar(6), periodo);
      const resFechas = await reqFechas.query(`
        SELECT DISTINCT CONVERT(VARCHAR(10), [Fecha], 23) AS Fecha
        FROM (
          SELECT [Fecha_Mov] AS Fecha FROM [DWH_Gestion_Cartera].[dbo].[fct_gerencia_ahorros_flujo] WITH (NOLOCK) WHERE [Periodo] = @periodo
          UNION
          SELECT [Fecha_Mov] AS Fecha FROM [DWH_Gestion_Cartera].[dbo].[fct_gerencia_caja_020] WITH (NOLOCK) WHERE [Periodo] = @periodo
          UNION
          SELECT [Fecha_Corte] AS Fecha FROM [DWH_Gestion_Cartera].[dbo].[fct_gerencia_ahorros_stock] WITH (NOLOCK) WHERE [Periodo] = @periodo
        ) F
        WHERE [Fecha] IS NOT NULL
        ORDER BY Fecha DESC;
      `);
      const fechasDisponibles = resFechas.recordset.map((r: any) => r.Fecha);

      const colAgencia = separar98 ? "[IdSAgencia_Separada]" : "[IdSAgencia_Origen]";
      const tieneFechaExacta =
        fechaFiltro !== "CIERRE" && fechaFiltro !== "" && fechaFiltro !== "Todas";

      let codAgenciaFiltro = "";
      if (agenciaFiltro !== "Todas" && agenciaFiltro !== "") {
        const foundEntry = Object.entries(AGENCY_NAMES).find(
          ([code, name]) =>
            code === agenciaFiltro || name.toLowerCase() === agenciaFiltro.toLowerCase()
        );
        codAgenciaFiltro = foundEntry ? foundEntry[0] : agenciaFiltro;
      }

      // 3. Consultar Stock de Ahorros, Aportes y Plazo Fijo (excluyendo siempre 09-101)
      const reqAho = pool.request();
      reqAho.input("periodo", sql.VarChar(6), periodo);
      reqAho.input("fecha", sql.VarChar(10), tieneFechaExacta ? fechaFiltro : "");
      reqAho.input("agencia", sql.VarChar(10), codAgenciaFiltro);
      reqAho.input("asesor", sql.VarChar(50), asesorFiltro === "Todos" ? "" : asesorFiltro);
      reqAho.input("moneda", sql.VarChar(15), monedaFiltro);

      const queryAhoStock = `
        DECLARE @FechaStock DATE;
        IF @fecha <> '' AND EXISTS (
          SELECT 1 FROM [DWH_Gestion_Cartera].[dbo].[fct_gerencia_ahorros_stock] WITH (NOLOCK)
          WHERE [Periodo] = @periodo AND [Fecha_Corte] = CAST(@fecha AS DATE)
        )
          SET @FechaStock = CAST(@fecha AS DATE);
        ELSE
          SELECT @FechaStock = MAX([Fecha_Corte])
          FROM [DWH_Gestion_Cartera].[dbo].[fct_gerencia_ahorros_stock] WITH (NOLOCK)
          WHERE [Periodo] = @periodo;

        SELECT
          ${colAgencia} AS IdSAgencia,
          [IdSAsesor],
          MAX([Nombre_Usuario]) AS Nombre_Usuario,
          LTRIM(RTRIM([Tipo_Aho])) AS Tipo_Aho,
          LTRIM(RTRIM([Subtipo_Aho])) AS Subtipo_Aho,
          MAX([Nombre_Producto]) AS Nombre_Producto,
          LTRIM(RTRIM([Moneda])) AS Moneda,
          MAX(ISNULL([Tipo_Cambio], 1.0000)) AS Tipo_Cambio,
          SUM([Nro_Cuentas]) AS Nro_Cuentas,
          SUM([Saldo_Total]) AS Saldo_Original,
          SUM([Numerador_Saldo_x_TEA]) AS Numerador_TEA_Original
        FROM [DWH_Gestion_Cartera].[dbo].[fct_gerencia_ahorros_stock] WITH (NOLOCK)
        WHERE [Periodo] = @periodo
          AND (@FechaStock IS NULL OR [Fecha_Corte] = @FechaStock)
          AND NOT (LTRIM(RTRIM([Tipo_Aho])) = '09' AND LTRIM(RTRIM([Subtipo_Aho])) = '101')
          AND (@agencia = '' OR ${colAgencia} = @agencia)
          AND (@asesor = '' OR [IdSAsesor] = @asesor OR [Nombre_Usuario] = @asesor)
          AND (@moneda = 'CONSOLIDADO' OR [Moneda] = @moneda)
        GROUP BY ${colAgencia}, [IdSAsesor], LTRIM(RTRIM([Tipo_Aho])), LTRIM(RTRIM([Subtipo_Aho])), LTRIM(RTRIM([Moneda]));
      `;

      // 4. Consultar Flujo de Ahorros y Aportes (excluyendo siempre 09-101)
      const reqFlujo = pool.request();
      reqFlujo.input("periodo", sql.VarChar(6), periodo);
      reqFlujo.input("fecha", sql.VarChar(10), tieneFechaExacta ? fechaFiltro : "");
      reqFlujo.input("agencia", sql.VarChar(10), codAgenciaFiltro);
      reqFlujo.input("asesor", sql.VarChar(50), asesorFiltro === "Todos" ? "" : asesorFiltro);
      reqFlujo.input("moneda", sql.VarChar(15), monedaFiltro);

      const queryAhoFlujo = `
        SELECT
          ${colAgencia} AS IdSAgencia,
          [IdSAsesor],
          MAX([Nombre_Usuario]) AS Nombre_Usuario,
          LTRIM(RTRIM([Tipo_Aho])) AS Tipo_Aho,
          LTRIM(RTRIM([Subtipo_Aho])) AS Subtipo_Aho,
          MAX([Nombre_Producto]) AS Nombre_Producto,
          LTRIM(RTRIM([Moneda])) AS Moneda,
          MAX(ISNULL([Tipo_Cambio], 1.0000)) AS Tipo_Cambio,
          SUM([Monto_Depositos]) AS Monto_Depositos,
          SUM([Monto_Retiros]) AS Monto_Retiros,
          SUM([Nro_Depositos]) AS Nro_Depositos,
          SUM([Nro_Retiros]) AS Nro_Retiros
        FROM [DWH_Gestion_Cartera].[dbo].[fct_gerencia_ahorros_flujo] WITH (NOLOCK)
        WHERE [Periodo] = @periodo
          AND (@fecha = '' OR [Fecha_Mov] = CAST(@fecha AS DATE))
          AND NOT (LTRIM(RTRIM([Tipo_Aho])) = '09' AND LTRIM(RTRIM([Subtipo_Aho])) = '101')
          AND (@agencia = '' OR ${colAgencia} = @agencia)
          AND (@asesor = '' OR [IdSAsesor] = @asesor OR [Nombre_Usuario] = @asesor)
          AND (@moneda = 'CONSOLIDADO' OR [Moneda] = @moneda)
        GROUP BY ${colAgencia}, [IdSAsesor], LTRIM(RTRIM([Tipo_Aho])), LTRIM(RTRIM([Subtipo_Aho])), LTRIM(RTRIM([Moneda]));
      `;

      // 5. Consultar Saldo de Colocaciones y TEA Activa
      const reqColoc = pool.request();
      reqColoc.input("periodo", sql.VarChar(6), periodo);
      reqColoc.input("fecha", sql.VarChar(10), tieneFechaExacta ? fechaFiltro : "");
      reqColoc.input("agencia", sql.VarChar(10), codAgenciaFiltro);
      reqColoc.input("asesor", sql.VarChar(50), asesorFiltro === "Todos" ? "" : asesorFiltro);
      reqColoc.input("todoPreec", sql.Bit, incluirTodoPreec ? 1 : 0);

      const queryColoc = `
        DECLARE @FechaColoc DATE;
        IF @fecha <> '' AND EXISTS (
          SELECT 1 FROM [DWH_Gestion_Cartera].[dbo].[fct_gerencia_colocaciones] WITH (NOLOCK)
          WHERE [Periodo] = @periodo AND [Fecha_Corte] <= CAST(@fecha AS DATE)
        )
          SELECT @FechaColoc = MAX([Fecha_Corte])
          FROM [DWH_Gestion_Cartera].[dbo].[fct_gerencia_colocaciones] WITH (NOLOCK)
          WHERE [Periodo] = @periodo AND [Fecha_Corte] <= CAST(@fecha AS DATE);
        ELSE
          SELECT @FechaColoc = MAX([Fecha_Corte])
          FROM [DWH_Gestion_Cartera].[dbo].[fct_gerencia_colocaciones] WITH (NOLOCK)
          WHERE [Periodo] = @periodo;

        SELECT
          ${colAgencia} AS IdSAgencia,
          [IdSAsesor],
          MAX([Nombre_Asesor]) AS Nombre_Asesor,
          SUM([Nro_Creditos]) AS Nro_Creditos,
          SUM([Saldo_Colocaciones]) AS Saldo_Colocaciones,
          SUM([Numerador_Saldo_x_TEA]) AS Numerador_TEA
        FROM [DWH_Gestion_Cartera].[dbo].[fct_gerencia_colocaciones] WITH (NOLOCK)
        WHERE [Periodo] = @periodo
          AND (@FechaColoc IS NULL OR [Fecha_Corte] = @FechaColoc)
          AND (@todoPreec = 1 OR [Es_Cartera_Comercial] = 1)
          AND (@agencia = '' OR ${colAgencia} = @agencia)
          AND (@asesor = '' OR [IdSAsesor] = @asesor OR [Nombre_Asesor] = @asesor)
        GROUP BY ${colAgencia}, [IdSAsesor];
      `;

      // 6. Consultar Saldo Caja 020
      const reqCaja = pool.request();
      reqCaja.input("periodo", sql.VarChar(6), periodo);
      reqCaja.input("fecha", sql.VarChar(10), tieneFechaExacta ? fechaFiltro : "");
      reqCaja.input("agencia", sql.VarChar(10), codAgenciaFiltro);

      const queryCaja = `
        DECLARE @FechaCaja DATE;
        IF @fecha <> ''
          SELECT @FechaCaja = MAX([Fecha_Mov])
          FROM [DWH_Gestion_Cartera].[dbo].[fct_gerencia_caja_020] WITH (NOLOCK)
          WHERE [Periodo] = @periodo AND [Fecha_Mov] <= CAST(@fecha AS DATE);

        SELECT
          [IdSAgencia_Origen] AS IdSAgencia,
          MAX(ISNULL([Tipo_Cambio], 0)) AS Tipo_Cambio,
          SUM([Saldo_Inicial_MN]) AS Saldo_Inicial_MN,
          SUM([Total_Ingresos_MN]) AS Total_Ingresos_MN,
          SUM([Total_Egresos_MN]) AS Total_Egresos_MN,
          SUM([Saldo_Cierre_MN]) AS Saldo_Cierre_MN,
          SUM([Saldo_Cierre_ME]) AS Saldo_Cierre_ME
        FROM [DWH_Gestion_Cartera].[dbo].[fct_gerencia_caja_020] WITH (NOLOCK)
        WHERE [Periodo] = @periodo
          AND (
            (@fecha = '' AND [Es_Ultimo_Cierre_Periodo] = 1)
            OR (@fecha <> '' AND [Fecha_Mov] = @FechaCaja)
          )
          AND (@agencia = '' OR [IdSAgencia_Origen] = @agencia)
        GROUP BY [IdSAgencia_Origen];
      `;

      // 7. Consultar Saldo en Bancos (Manual)
      const reqBancos = pool.request();
      reqBancos.input("periodo", sql.VarChar(6), periodo);
      reqBancos.input("fecha", sql.VarChar(10), tieneFechaExacta ? fechaFiltro : "");
      reqBancos.input("moneda", sql.VarChar(15), monedaFiltro);

      const queryBancos = `
        SELECT
          [Id],
          [Periodo],
          CONVERT(VARCHAR(10), [Fecha_Corte], 23) + 'T12:00:00' AS Fecha_Corte,
          [Entidad_Bancaria],
          [Moneda],
          [Saldo_Banco],
          ISNULL([TEA_Pasiva_Banco], 0) AS TEA_Pasiva_Banco,
          [Observacion],
          [Usuario_Registro]
        FROM [DWH_Gestion_Cartera].[dbo].[fct_gerencia_bancos_manual] WITH (NOLOCK)
        WHERE [Periodo] = @periodo
          AND (@fecha = '' OR [Fecha_Corte] <= CAST(@fecha AS DATE))
          AND (@moneda = 'CONSOLIDADO' OR [Moneda] = @moneda)
        ORDER BY [Fecha_Corte] DESC, [Id] DESC;
      `;

      // 8. Consultar Serie Evolutiva (Mensual o Diaria)
      const reqEvo = pool.request();
      reqEvo.input("periodo", sql.VarChar(6), periodo);
      reqEvo.input("agencia", sql.VarChar(10), codAgenciaFiltro);
      reqEvo.input("todoPreec", sql.Bit, incluirTodoPreec ? 1 : 0);
      reqEvo.input("moneda", sql.VarChar(15), monedaFiltro);

      const exprFactorTC = `CASE WHEN [Moneda] = 'ME' THEN ISNULL([Tipo_Cambio], 3.433) ELSE 1.0 END`;

      const queryEvolutivo =
        granularidad === "Mensual"
          ? `
        WITH ColocMes AS (
          SELECT
            C.[Periodo] AS Etiqueta,
            SUM(C.[Saldo_Colocaciones]) AS Saldo_Colocaciones,
            SUM(C.[Numerador_Saldo_x_TEA]) / NULLIF(SUM(C.[Saldo_Colocaciones]), 0) AS TEA_Activa
          FROM [DWH_Gestion_Cartera].[dbo].[fct_gerencia_colocaciones] C WITH (NOLOCK)
          INNER JOIN (
            SELECT [Periodo], MAX([Fecha_Corte]) AS MaxFecha
            FROM [DWH_Gestion_Cartera].[dbo].[fct_gerencia_colocaciones] WITH (NOLOCK)
            GROUP BY [Periodo]
          ) M ON C.[Periodo] = M.[Periodo] AND C.[Fecha_Corte] = M.MaxFecha
          WHERE (@todoPreec = 1 OR C.[Es_Cartera_Comercial] = 1)
            AND (@agencia = '' OR C.${colAgencia} = @agencia)
          GROUP BY C.[Periodo]
        ),
        AhoMes AS (
          SELECT
            S.[Periodo] AS Etiqueta,
            SUM(CASE ${sqlFiltroCapStock} THEN S.[Saldo_Total] * (${exprFactorTC}) ELSE 0 END) AS Saldo_Ahorros,
            SUM(CASE WHEN LTRIM(RTRIM(S.[Tipo_Aho])) = '03' THEN S.[Saldo_Total] * (${exprFactorTC}) ELSE 0 END) AS Saldo_Plazo_Fijo,
            SUM(S.[Numerador_Saldo_x_TEA] * (${exprFactorTC})) / NULLIF(SUM(S.[Saldo_Total] * (${exprFactorTC})), 0) AS TEA_Pasiva
          FROM [DWH_Gestion_Cartera].[dbo].[fct_gerencia_ahorros_stock] S WITH (NOLOCK)
          WHERE S.[Es_Foto_Actual] = 1
            ${sqlExcluir09101Stock}
            AND (@agencia = '' OR S.${colAgencia} = @agencia)
            AND (@moneda = 'CONSOLIDADO' OR S.[Moneda] = @moneda)
          GROUP BY S.[Periodo]
        ),
        FlujoMes AS (
          SELECT
            [Periodo] AS Etiqueta,
            SUM([Monto_Depositos] * (${exprFactorTC})) AS Depositos,
            SUM([Monto_Retiros] * (${exprFactorTC})) AS Retiros
          FROM [DWH_Gestion_Cartera].[dbo].[fct_gerencia_ahorros_flujo] WITH (NOLOCK)
          WHERE 1 = 1
            ${sqlExcluir09101Flujo}
            AND (@agencia = '' OR ${colAgencia} = @agencia)
            AND (@moneda = 'CONSOLIDADO' OR [Moneda] = @moneda)
          GROUP BY [Periodo]
        ),
        CajaMes AS (
          SELECT
            [Periodo] AS Etiqueta,
            SUM([Saldo_Cierre_MN]) AS Saldo_Caja_020
          FROM [DWH_Gestion_Cartera].[dbo].[fct_gerencia_caja_020] WITH (NOLOCK)
          WHERE [Es_Ultimo_Cierre_Periodo] = 1
            AND (@agencia = '' OR [IdSAgencia_Origen] = @agencia)
          GROUP BY [Periodo]
        ),
        BancosMes AS (
          SELECT
            [Periodo] AS Etiqueta,
            SUM([Saldo_Banco]) AS Saldo_Bancos
          FROM [DWH_Gestion_Cartera].[dbo].[fct_gerencia_bancos_manual] WITH (NOLOCK)
          WHERE (@moneda = 'CONSOLIDADO' OR [Moneda] = @moneda)
          GROUP BY [Periodo]
        ),
        PeriodosBase AS (
          SELECT Etiqueta FROM AhoMes
          UNION SELECT Etiqueta FROM ColocMes
        )
        SELECT TOP 12
          P.Etiqueta AS etiqueta,
          ISNULL(A.Saldo_Ahorros, 0) AS saldoAhorros,
          ISNULL(A.Saldo_Plazo_Fijo, 0) AS saldoPlazoFijo,
          ISNULL(C.Saldo_Colocaciones, 0) AS saldoColocaciones,
          ISNULL(CJ.Saldo_Caja_020, 0) AS saldoCaja020,
          ISNULL(B.Saldo_Bancos, 0) AS saldoBancos,
          ISNULL(F.Depositos, 0) AS depositos,
          ISNULL(F.Retiros, 0) AS retiros,
          ISNULL(C.TEA_Activa, 0) AS teaActiva,
          ISNULL(A.TEA_Pasiva, 0) AS teaPasiva
        FROM PeriodosBase P
        LEFT JOIN ColocMes C ON P.Etiqueta = C.Etiqueta
        LEFT JOIN AhoMes A ON P.Etiqueta = A.Etiqueta
        LEFT JOIN FlujoMes F ON P.Etiqueta = F.Etiqueta
        LEFT JOIN CajaMes CJ ON P.Etiqueta = CJ.Etiqueta
        LEFT JOIN BancosMes B ON P.Etiqueta = B.Etiqueta
        ORDER BY P.Etiqueta ASC;
      `
          : `
        WITH FlujoAhoDia AS (
          SELECT
            CONVERT(VARCHAR(10), [Fecha_Mov], 23) AS Etiqueta,
            SUM([Monto_Depositos] * (${exprFactorTC})) AS Depositos,
            SUM([Monto_Retiros] * (${exprFactorTC})) AS Retiros,
            SUM(CASE ${sqlFiltroCapFlujo} THEN ([Monto_Depositos] - [Monto_Retiros]) * (${exprFactorTC}) ELSE 0 END) AS Delta_Ahorros,
            SUM(CASE WHEN LTRIM(RTRIM([Tipo_Aho])) = '03' THEN ([Monto_Depositos] - [Monto_Retiros]) * (${exprFactorTC}) ELSE 0 END) AS Delta_PF
          FROM [DWH_Gestion_Cartera].[dbo].[fct_gerencia_ahorros_flujo] WITH (NOLOCK)
          WHERE [Periodo] = @periodo
            ${sqlExcluir09101Flujo}
            AND (@agencia = '' OR ${colAgencia} = @agencia)
            AND (@moneda = 'CONSOLIDADO' OR [Moneda] = @moneda)
          GROUP BY CONVERT(VARCHAR(10), [Fecha_Mov], 23)
        ),
        FlujoColocDia AS (
          SELECT
            CONVERT(VARCHAR(10), [Fecha_Mov], 23) AS Etiqueta,
            SUM(ISNULL([Monto_Desembolsos], 0) - ISNULL([Monto_Repagos], 0)) AS Delta_Colocaciones
          FROM [DWH_Gestion_Cartera].[dbo].[fct_gerencia_colocaciones_flujo] WITH (NOLOCK)
          WHERE [Periodo] = @periodo
            AND (@agencia = '' OR ${colAgencia} = @agencia)
            AND (@todoPreec = 1 OR [Es_Cartera_Comercial] = 1)
          GROUP BY CONVERT(VARCHAR(10), [Fecha_Mov], 23)
        ),
        CajaDia AS (
          SELECT
            CONVERT(VARCHAR(10), [Fecha_Mov], 23) AS Etiqueta,
            SUM([Saldo_Cierre_MN]) AS Saldo_Caja_020
          FROM [DWH_Gestion_Cartera].[dbo].[fct_gerencia_caja_020] WITH (NOLOCK)
          WHERE [Periodo] = @periodo
            AND (@agencia = '' OR [IdSAgencia_Origen] = @agencia)
          GROUP BY CONVERT(VARCHAR(10), [Fecha_Mov], 23)
        ),
        FechasBase AS (
          SELECT Etiqueta FROM FlujoAhoDia
          UNION SELECT Etiqueta FROM FlujoColocDia
          UNION SELECT Etiqueta FROM CajaDia
        )
        SELECT
          F.Etiqueta AS etiqueta,
          ISNULL(FA.Depositos, 0) AS depositos,
          ISNULL(FA.Retiros, 0) AS retiros,
          ISNULL(FA.Delta_Ahorros, 0) AS deltaAhorros,
          ISNULL(FA.Delta_PF, 0) AS deltaPF,
          ISNULL(FC.Delta_Colocaciones, 0) AS deltaColocaciones,
          ISNULL(CJ.Saldo_Caja_020, 0) AS saldoCaja020
        FROM FechasBase F
        LEFT JOIN FlujoAhoDia FA ON F.Etiqueta = FA.Etiqueta
        LEFT JOIN FlujoColocDia FC ON F.Etiqueta = FC.Etiqueta
        LEFT JOIN CajaDia CJ ON F.Etiqueta = CJ.Etiqueta
        ORDER BY F.Etiqueta ASC;
      `;

      const [resAho, resFlujo, resColoc, resCaja, resBancos, resEvo] = await Promise.all([
        reqAho.query(queryAhoStock),
        reqFlujo.query(queryAhoFlujo),
        reqColoc.query(queryColoc),
        reqCaja.query(queryCaja),
        reqBancos.query(queryBancos),
        reqEvo.query(queryEvolutivo),
      ]);

      const ahoRows = resAho.recordset || [];
      const flujoRows = resFlujo.recordset || [];
      const colocRows = resColoc.recordset || [];
      const cajaRows = resCaja.recordset || [];
      const bancosRows = resBancos.recordset || [];
      const evoRows = resEvo.recordset || [];

      // 9. Consultar Reclasificación de Colocaciones desde el DWH local (CERO conexión a TRANSACMIF)
      let porTipoPrestamo: any[] = [];
      try {
        const reqPres = pool.request();
        reqPres.input("periodo", sql.VarChar(6), periodo);
        reqPres.input("fecha", sql.VarChar(10), tieneFechaExacta ? fechaFiltro : "");
        reqPres.input("agencia", sql.VarChar(10), codAgenciaFiltro);
        reqPres.input("asesor", sql.VarChar(50), asesorFiltro === "Todos" ? "" : asesorFiltro);
        reqPres.input("todoPreec", sql.Bit, incluirTodoPreec ? 1 : 0);

        const resPres = await reqPres.query(`
          IF OBJECT_ID('[DWH_Gestion_Cartera].[dbo].[fct_gerencia_colocaciones_tipo]', 'U') IS NOT NULL
          BEGIN
            DECLARE @FechaColocTipo DATE;
            IF @fecha <> '' AND EXISTS (
              SELECT 1 FROM [DWH_Gestion_Cartera].[dbo].[fct_gerencia_colocaciones_tipo] WITH (NOLOCK)
              WHERE [Periodo] = @periodo AND [Fecha_Corte] <= CAST(@fecha AS DATE)
            )
              SELECT @FechaColocTipo = MAX([Fecha_Corte])
              FROM [DWH_Gestion_Cartera].[dbo].[fct_gerencia_colocaciones_tipo] WITH (NOLOCK)
              WHERE [Periodo] = @periodo AND [Fecha_Corte] <= CAST(@fecha AS DATE);
            ELSE
              SELECT @FechaColocTipo = MAX([Fecha_Corte])
              FROM [DWH_Gestion_Cartera].[dbo].[fct_gerencia_colocaciones_tipo] WITH (NOLOCK)
              WHERE [Periodo] = @periodo;

            SELECT
              ISNULL(LTRIM(RTRIM([Cod_Tipo_Pres])), '00') AS codTipo,
              ISNULL(LTRIM(RTRIM([Tipo_Prestamo])), 'OTROS') AS tipoPrestamo,
              SUM([Nro_Creditos]) AS nroCreditos,
              SUM([Saldo_Colocaciones]) AS saldoColocaciones,
              SUM([Saldo_Vigente]) AS saldoVigente,
              SUM([Saldo_Refinanciado]) AS saldoRefinanciado,
              SUM([Saldo_Judicial]) AS saldoJudicial,
              SUM([Saldo_Vencido]) AS saldoVencido,
              SUM([Numerador_Saldo_x_TEA]) AS numeradorTea
            FROM [DWH_Gestion_Cartera].[dbo].[fct_gerencia_colocaciones_tipo] WITH (NOLOCK)
            WHERE [Periodo] = @periodo
              AND (@FechaColocTipo IS NULL OR [Fecha_Corte] = @FechaColocTipo)
              AND (@todoPreec = 1 OR [Es_Cartera_Comercial] = 1)
              AND (@agencia = '' OR ${colAgencia} = @agencia)
              AND (@asesor = '' OR [IdSAsesor] = @asesor OR [Nombre_Asesor] = @asesor)
            GROUP BY [Cod_Tipo_Pres], [Tipo_Prestamo]
            ORDER BY saldoColocaciones DESC;
          END
        `);

        porTipoPrestamo = (resPres.recordset || []).map((r: any) => {
          const saldo = Number(r.saldoColocaciones || 0);
          const venc = Number(r.saldoVencido || 0) + Number(r.saldoJudicial || 0);
          return {
            codTipo: r.codTipo,
            tipoPrestamo: r.tipoPrestamo,
            nroCreditos: Number(r.nroCreditos || 0),
            saldoColocaciones: saldo,
            saldoVigente: Number(r.saldoVigente || 0),
            saldoRefinanciado: Number(r.saldoRefinanciado || 0),
            saldoJudicial: Number(r.saldoJudicial || 0),
            saldoVencido: Number(r.saldoVencido || 0),
            pctMora: saldo > 0 ? Number(((venc / saldo) * 100).toFixed(2)) : 0,
            teaPonderada: Number((saldo > 0 ? Number(r.numeradorTea || 0) / saldo : 0).toFixed(2)),
          };
        });
      } catch (errTipo) {
        console.warn("Aviso leyendo fct_gerencia_colocaciones_tipo en DWH:", errTipo);
      }

      let tipoCambioPeriodo = 0;
      for (const r of ahoRows) {
        if (String(r.Moneda).trim() === "ME" && Number(r.Tipo_Cambio) > 0) {
          tipoCambioPeriodo = Number(r.Tipo_Cambio);
          break;
        }
      }
      if (tipoCambioPeriodo === 0 && cajaRows.length > 0) {
        for (const c of cajaRows) {
          if (Number(c.Tipo_Cambio) > 0) {
            tipoCambioPeriodo = Number(c.Tipo_Cambio);
            break;
          }
        }
      }

      const agenciaMap = new Map<string, any>();
      const asesorMap = new Map<string, any>();
      const productoMap = new Map<string, any>();

      const ensureAgencia = (cod: string) => {
        const cleanCod = String(cod || "01").trim().padStart(2, "0");
        if (!agenciaMap.has(cleanCod)) {
          agenciaMap.set(cleanCod, {
            idAgencia: cleanCod,
            agencia: AGENCY_NAMES[cleanCod] || `Agencia ${cleanCod}`,
            saldoAhorros: 0,
            saldoAhorrosUSD: 0,
            saldoAhorrosUSD_Soles: 0,
            numTeaAhorros: 0,
            saldoSoloAhorros: 0,
            saldoSoloAhorrosUSD: 0,
            numTeaSoloAhorros: 0,
            saldoSoloAportes: 0,
            saldoSoloAportesUSD: 0,
            numTeaSoloAportes: 0,
            saldoPlazoFijo: 0,
            saldoPlazoFijoUSD: 0,
            saldoPlazoFijoUSD_Soles: 0,
            numTeaPlazoFijo: 0,
            depositos: 0,
            depositosUSD: 0,
            retiros: 0,
            retirosUSD: 0,
            saldoColocaciones: 0,
            numTeaColocaciones: 0,
            nroCreditos: 0,
            saldoCaja020: 0,
            saldoCaja020USD: 0,
          });
        }
        return agenciaMap.get(cleanCod);
      };

      const ensureAsesor = (idAsesor: string, nombre: string, codAgencia: string) => {
        const key = String(idAsesor || "SISTEMA").trim();
        const cleanCod = String(codAgencia || "01").trim().padStart(2, "0");
        if (!asesorMap.has(key)) {
          asesorMap.set(key, {
            idAsesor: key,
            nombre: String(nombre || key).trim(),
            idAgencia: cleanCod,
            agencia: AGENCY_NAMES[cleanCod] || `Agencia ${cleanCod}`,
            saldoAhorros: 0,
            saldoAhorrosUSD: 0,
            saldoAhorrosUSD_Soles: 0,
            numTeaAhorros: 0,
            saldoSoloAhorros: 0,
            numTeaSoloAhorros: 0,
            saldoSoloAportes: 0,
            numTeaSoloAportes: 0,
            saldoPlazoFijo: 0,
            saldoPlazoFijoUSD: 0,
            saldoPlazoFijoUSD_Soles: 0,
            numTeaPlazoFijo: 0,
            depositos: 0,
            retiros: 0,
            saldoColocaciones: 0,
            numTeaColocaciones: 0,
            nroCreditos: 0,
          });
        }
        return asesorMap.get(key);
      };

      let kpiSaldoAhorrosSoles = 0;
      let kpiSaldoAhorrosUSD = 0;
      let kpiSaldoAhorrosUSD_EnSoles = 0;
      let kpiNumTeaAhorros = 0;

      // Desglose permanente separado:
      // 1) Solo Ahorros (sin 01, sin 09-102 y sin 09-101)
      let kpiSoloAhorrosSoles = 0;
      let kpiSoloAhorrosUSD = 0;
      let kpiSoloAhorrosUSD_EnSoles = 0;
      let kpiNumTeaSoloAhorros = 0;

      // 2) Solo Aportes (01-101, 01-102, 01-103 + 09-102 Ahorro Pres)
      let kpiSoloAportesSoles = 0;
      let kpiSoloAportesUSD = 0;
      let kpiSoloAportesUSD_EnSoles = 0;
      let kpiNumTeaSoloAportes = 0;

      let kpiSaldoPFSoles = 0;
      let kpiSaldoPFUSD = 0;
      let kpiSaldoPFUSD_EnSoles = 0;
      let kpiNumTeaPF = 0;

      ahoRows.forEach((r: any) => {
        const tipoAho = String(r.Tipo_Aho || "").trim();
        const subtipoAho = String(r.Subtipo_Aho || "").trim();

        // Excluir terminantemente 09-101 (29180702 DESEMBOLSO CREDITO)
        if (esSubtipoExcluido(tipoAho, subtipoAho)) return;

        const esME = String(r.Moneda).trim() === "ME";
        const tc = esME ? Number(r.Tipo_Cambio || tipoCambioPeriodo) : 1.0;
        const saldoOrig = Number(r.Saldo_Original || 0);
        const saldoEnSoles = esME ? saldoOrig * tc : saldoOrig;
        const numTeaEnSoles = Number(r.Numerador_TEA_Original || 0) * tc;
        const esPF = tipoAho === "03";
        const esAporte = esSubtipoAporte(tipoAho, subtipoAho);

        const ag = ensureAgencia(r.IdSAgencia);
        const as = ensureAsesor(r.IdSAsesor, r.Nombre_Usuario, r.IdSAgencia);

        if (esPF) {
          kpiSaldoPFSoles += saldoEnSoles;
          kpiNumTeaPF += numTeaEnSoles;
          ag.saldoPlazoFijo += saldoEnSoles;
          ag.numTeaPlazoFijo += numTeaEnSoles;
          as.saldoPlazoFijo += saldoEnSoles;
          as.numTeaPlazoFijo += numTeaEnSoles;

          if (esME) {
            kpiSaldoPFUSD += saldoOrig;
            kpiSaldoPFUSD_EnSoles += saldoEnSoles;
            ag.saldoPlazoFijoUSD += saldoOrig;
            ag.saldoPlazoFijoUSD_Soles += saldoEnSoles;
            as.saldoPlazoFijoUSD += saldoOrig;
            as.saldoPlazoFijoUSD_Soles += saldoEnSoles;
          }
        } else {
          if (esAporte) {
            kpiSoloAportesSoles += saldoEnSoles;
            kpiNumTeaSoloAportes += numTeaEnSoles;
            ag.saldoSoloAportes += saldoEnSoles;
            ag.numTeaSoloAportes += numTeaEnSoles;
            as.saldoSoloAportes += saldoEnSoles;
            as.numTeaSoloAportes += numTeaEnSoles;
            if (esME) {
              kpiSoloAportesUSD += saldoOrig;
              kpiSoloAportesUSD_EnSoles += saldoEnSoles;
              ag.saldoSoloAportesUSD += saldoOrig;
            }
          } else {
            kpiSoloAhorrosSoles += saldoEnSoles;
            kpiNumTeaSoloAhorros += numTeaEnSoles;
            ag.saldoSoloAhorros += saldoEnSoles;
            ag.numTeaSoloAhorros += numTeaEnSoles;
            as.saldoSoloAhorros += saldoEnSoles;
            as.numTeaSoloAhorros += numTeaEnSoles;
            if (esME) {
              kpiSoloAhorrosUSD += saldoOrig;
              kpiSoloAhorrosUSD_EnSoles += saldoEnSoles;
              ag.saldoSoloAhorrosUSD += saldoOrig;
            }
          }

          const incluirEnActivo =
            tipoCaptacion === "COMBINADO" ||
            (tipoCaptacion === "APORTES" && esAporte) ||
            (tipoCaptacion === "AHORROS" && !esAporte);

          if (incluirEnActivo) {
            kpiSaldoAhorrosSoles += saldoEnSoles;
            kpiNumTeaAhorros += numTeaEnSoles;
            ag.saldoAhorros += saldoEnSoles;
            ag.numTeaAhorros += numTeaEnSoles;
            as.saldoAhorros += saldoEnSoles;
            as.numTeaAhorros += numTeaEnSoles;

            if (esME) {
              kpiSaldoAhorrosUSD += saldoOrig;
              kpiSaldoAhorrosUSD_EnSoles += saldoEnSoles;
              ag.saldoAhorrosUSD += saldoOrig;
              ag.saldoAhorrosUSD_Soles += saldoEnSoles;
              as.saldoAhorrosUSD += saldoOrig;
              as.saldoAhorrosUSD_Soles += saldoEnSoles;
            }
          }
        }

        const mostrarProducto =
          esPF ||
          tipoCaptacion === "COMBINADO" ||
          (tipoCaptacion === "APORTES" && esAporte) ||
          (tipoCaptacion === "AHORROS" && !esAporte);

        if (mostrarProducto) {
          const prodKey = `${tipoAho}-${subtipoAho}`;
          if (!productoMap.has(prodKey)) {
            productoMap.set(prodKey, {
              codigo: prodKey,
              tipoAho,
              subtipoAho,
              categoria: esPF ? "PLAZO FIJO" : esAporte ? "APORTES (31110101)" : "AHORROS",
              producto: r.Nombre_Producto,
              moneda: r.Moneda,
              tipoCambio: Number(tc.toFixed(4)),
              nroCuentas: 0,
              saldoOriginal: 0,
              saldoTotal: 0,
              numTea: 0,
              depositosOriginal: 0,
              depositos: 0,
              retirosOriginal: 0,
              retiros: 0,
            });
          }
          const prod = productoMap.get(prodKey);
          prod.nroCuentas += Number(r.Nro_Cuentas || 0);
          prod.saldoOriginal += saldoOrig;
          prod.saldoTotal += saldoEnSoles;
          prod.numTea += numTeaEnSoles;
        }
      });

      let kpiDepositosSoles = 0;
      let kpiDepositosUSD = 0;
      let kpiRetirosSoles = 0;
      let kpiRetirosUSD = 0;

      flujoRows.forEach((r: any) => {
        const tipoAho = String(r.Tipo_Aho || "").trim();
        const subtipoAho = String(r.Subtipo_Aho || "").trim();

        if (esSubtipoExcluido(tipoAho, subtipoAho)) return;

        const esPF = tipoAho === "03";
        const esAporte = esSubtipoAporte(tipoAho, subtipoAho);

        const incluirFlujo =
          esPF ||
          tipoCaptacion === "COMBINADO" ||
          (tipoCaptacion === "APORTES" && esAporte) ||
          (tipoCaptacion === "AHORROS" && !esAporte);

        if (!incluirFlujo) return;

        const esME = String(r.Moneda).trim() === "ME";
        const tc = esME ? Number(r.Tipo_Cambio || tipoCambioPeriodo) : 1.0;
        const depOrig = Number(r.Monto_Depositos || 0);
        const retOrig = Number(r.Monto_Retiros || 0);
        const depSoles = esME ? depOrig * tc : depOrig;
        const retSoles = esME ? retOrig * tc : retOrig;

        kpiDepositosSoles += depSoles;
        kpiRetirosSoles += retSoles;
        if (esME) {
          kpiDepositosUSD += depOrig;
          kpiRetirosUSD += retOrig;
        }

        const ag = ensureAgencia(r.IdSAgencia);
        ag.depositos += depSoles;
        ag.retiros += retSoles;
        if (esME) {
          ag.depositosUSD += depOrig;
          ag.retirosUSD += retOrig;
        }

        const as = ensureAsesor(r.IdSAsesor, r.Nombre_Usuario, r.IdSAgencia);
        as.depositos += depSoles;
        as.retiros += retSoles;

        const prodKey = `${tipoAho}-${subtipoAho}`;
        if (productoMap.has(prodKey)) {
          const prod = productoMap.get(prodKey);
          prod.depositosOriginal += depOrig;
          prod.depositos += depSoles;
          prod.retirosOriginal += retOrig;
          prod.retiros += retSoles;
        }
      });

      let kpiSaldoColoc = 0;
      let kpiNumTeaColoc = 0;
      let kpiNroCreditos = 0;

      colocRows.forEach((r: any) => {
        const saldo = Number(r.Saldo_Colocaciones || 0);
        const numTea = Number(r.Numerador_TEA || 0);
        const creds = Number(r.Nro_Creditos || 0);

        kpiSaldoColoc += saldo;
        kpiNumTeaColoc += numTea;
        kpiNroCreditos += creds;

        const ag = ensureAgencia(r.IdSAgencia);
        ag.saldoColocaciones += saldo;
        ag.numTeaColocaciones += numTea;
        ag.nroCreditos += creds;

        const as = ensureAsesor(r.IdSAsesor, r.Nombre_Asesor, r.IdSAgencia);
        as.saldoColocaciones += saldo;
        as.numTeaColocaciones += numTea;
        as.nroCreditos += creds;
      });

      let kpiSaldoCaja020 = 0;
      let kpiSaldoCaja020USD = 0;
      let kpiSaldoCaja020USD_EnSoles = 0;

      cajaRows.forEach((r: any) => {
        const cierreMN = Number(r.Saldo_Cierre_MN || 0);
        const cierreME = Number(r.Saldo_Cierre_ME || 0);
        const cierreME_Soles = cierreME * tipoCambioPeriodo;

        const ag = ensureAgencia(r.IdSAgencia);
        ag.saldoCaja020USD += cierreME;

        if (monedaFiltro === "ME") {
          kpiSaldoCaja020 += cierreME_Soles;
          kpiSaldoCaja020USD += cierreME;
          kpiSaldoCaja020USD_EnSoles += cierreME_Soles;
          ag.saldoCaja020 += cierreME_Soles;
        } else if (monedaFiltro === "CONSOLIDADO") {
          kpiSaldoCaja020 += cierreMN + cierreME_Soles;
          kpiSaldoCaja020USD += cierreME;
          kpiSaldoCaja020USD_EnSoles += cierreME_Soles;
          ag.saldoCaja020 += cierreMN + cierreME_Soles;
        } else {
          kpiSaldoCaja020 += cierreMN;
          ag.saldoCaja020 += cierreMN;
        }
      });

      let kpiSaldoBancos = 0;
      let kpiSaldoBancosUSD = 0;
      bancosRows.forEach((b: any) => {
        const esME = String(b.Moneda).trim() === "ME";
        const monto = Number(b.Saldo_Banco || 0);
        if (esME) {
          kpiSaldoBancosUSD += monto;
          kpiSaldoBancos += monto * tipoCambioPeriodo;
        } else {
          kpiSaldoBancos += monto;
        }
      });

      const teaPasivaAhorros =
        kpiSaldoAhorrosSoles > 0 ? kpiNumTeaAhorros / kpiSaldoAhorrosSoles : 0;
      const teaSoloAhorros =
        kpiSoloAhorrosSoles > 0 ? kpiNumTeaSoloAhorros / kpiSoloAhorrosSoles : 0;
      const teaSoloAportes =
        kpiSoloAportesSoles > 0 ? kpiNumTeaSoloAportes / kpiSoloAportesSoles : 0;
      const teaPasivaPlazoFijo =
        kpiSaldoPFSoles > 0 ? kpiNumTeaPF / kpiSaldoPFSoles : 0;
      const saldoCaptacionesTotal = kpiSaldoAhorrosSoles + kpiSaldoPFSoles;
      const teaPasivaGlobal =
        saldoCaptacionesTotal > 0
          ? (kpiNumTeaAhorros + kpiNumTeaPF) / saldoCaptacionesTotal
          : 0;
      const teaActivaPonderada =
        kpiSaldoColoc > 0 ? kpiNumTeaColoc / kpiSaldoColoc : 0;
      const spreadFinanciero = teaActivaPonderada - teaPasivaGlobal;

      const porAgencia = Array.from(agenciaMap.values())
        .map((a) => {
          const totalCap = a.saldoAhorros + a.saldoPlazoFijo;
          const teaAho = a.saldoAhorros > 0 ? a.numTeaAhorros / a.saldoAhorros : 0;
          const teaSoloAho =
            a.saldoSoloAhorros > 0 ? a.numTeaSoloAhorros / a.saldoSoloAhorros : 0;
          const teaSoloApo =
            a.saldoSoloAportes > 0 ? a.numTeaSoloAportes / a.saldoSoloAportes : 0;
          const teaPF =
            a.saldoPlazoFijo > 0 ? a.numTeaPlazoFijo / a.saldoPlazoFijo : 0;
          const teaPasiva =
            totalCap > 0 ? (a.numTeaAhorros + a.numTeaPlazoFijo) / totalCap : 0;
          const teaActiva =
            a.saldoColocaciones > 0
              ? a.numTeaColocaciones / a.saldoColocaciones
              : 0;
          return {
            ...a,
            totalCaptaciones: totalCap,
            teaAhorros: Number(teaAho.toFixed(2)),
            teaSoloAhorros: Number(teaSoloAho.toFixed(2)),
            teaSoloAportes: Number(teaSoloApo.toFixed(2)),
            teaPlazoFijo: Number(teaPF.toFixed(2)),
            teaPasivaTotal: Number(teaPasiva.toFixed(2)),
            teaActiva: Number(teaActiva.toFixed(2)),
            spread: Number((teaActiva - teaPasiva).toFixed(2)),
          };
        })
        .sort((a, b) => a.idAgencia.localeCompare(b.idAgencia));

      const porAsesor = Array.from(asesorMap.values())
        .map((as) => {
          const totalCap = as.saldoAhorros + as.saldoPlazoFijo;
          const teaAho =
            as.saldoAhorros > 0 ? as.numTeaAhorros / as.saldoAhorros : 0;
          const teaSoloAho =
            as.saldoSoloAhorros > 0 ? as.numTeaSoloAhorros / as.saldoSoloAhorros : 0;
          const teaSoloApo =
            as.saldoSoloAportes > 0 ? as.numTeaSoloAportes / as.saldoSoloAportes : 0;
          const teaPF =
            as.saldoPlazoFijo > 0 ? as.numTeaPlazoFijo / as.saldoPlazoFijo : 0;
          const teaPasiva =
            totalCap > 0
              ? (as.numTeaAhorros + as.numTeaPlazoFijo) / totalCap
              : 0;
          const teaActiva =
            as.saldoColocaciones > 0
              ? as.numTeaColocaciones / as.saldoColocaciones
              : 0;
          return {
            ...as,
            totalCaptaciones: totalCap,
            teaAhorros: Number(teaAho.toFixed(2)),
            teaSoloAhorros: Number(teaSoloAho.toFixed(2)),
            teaSoloAportes: Number(teaSoloApo.toFixed(2)),
            teaPlazoFijo: Number(teaPF.toFixed(2)),
            teaPasivaTotal: Number(teaPasiva.toFixed(2)),
            teaActiva: Number(teaActiva.toFixed(2)),
          };
        })
        .sort(
          (a, b) =>
            b.saldoColocaciones +
            b.totalCaptaciones -
            (a.saldoColocaciones + a.totalCaptaciones)
        );

      const porProductoAhorro = Array.from(productoMap.values())
        .map((p) => ({
          ...p,
          teaPonderada: Number(
            (p.saldoTotal > 0 ? p.numTea / p.saldoTotal : 0).toFixed(2)
          ),
          flujoNeto: p.depositos - p.retiros,
        }))
        .sort((a, b) => b.saldoTotal - a.saldoTotal);

      let serieEvolutivaFinal: any[] = [];
      if (granularidad === "Diario" && evoRows.length > 0) {
        let runningAho = kpiSaldoAhorrosSoles;
        let runningPF = kpiSaldoPFSoles;
        let runningColoc = kpiSaldoColoc;
        let lastValidCaja = kpiSaldoCaja020;

        const reversed = [...evoRows].reverse();
        const reconstructedReversed = reversed.map((dia: any) => {
          const cajaDia = Number(dia.saldoCaja020 || 0);
          if (cajaDia > 0) {
            lastValidCaja = cajaDia;
          }
          const item = {
            etiqueta: dia.etiqueta,
            saldoAhorros: Math.max(0, Number(runningAho.toFixed(2))),
            saldoPlazoFijo: Math.max(0, Number(runningPF.toFixed(2))),
            saldoColocaciones: Math.max(0, Number(runningColoc.toFixed(2))),
            saldoCaja020: cajaDia > 0 ? cajaDia : lastValidCaja,
            saldoBancos: kpiSaldoBancos,
            depositos: Number(dia.depositos || 0),
            retiros: Number(dia.retiros || 0),
            teaActiva: Number(teaActivaPonderada.toFixed(2)),
            teaPasiva: Number(teaPasivaGlobal.toFixed(2)),
            spread: Number(spreadFinanciero.toFixed(2)),
          };
          runningAho -= Number(dia.deltaAhorros || 0);
          runningPF -= Number(dia.deltaPF || 0);
          runningColoc -= Number(dia.deltaColocaciones || 0);
          return item;
        });
        serieEvolutivaFinal = reconstructedReversed.reverse();
      } else {
        serieEvolutivaFinal = evoRows.map((e: any) => ({
          etiqueta: e.etiqueta,
          saldoAhorros: Number(e.saldoAhorros || 0),
          saldoPlazoFijo: Number(e.saldoPlazoFijo || 0),
          saldoColocaciones: Number(e.saldoColocaciones || 0),
          saldoCaja020: Number(e.saldoCaja020 || 0),
          saldoBancos: Number(e.saldoBancos || 0),
          depositos: Number(e.depositos || 0),
          retiros: Number(e.retiros || 0),
          teaActiva: Number(Number(e.teaActiva || 0).toFixed(2)),
          teaPasiva: Number(Number(e.teaPasiva || 0).toFixed(2)),
          spread: Number(
            (Number(e.teaActiva || 0) - Number(e.teaPasiva || 0)).toFixed(2)
          ),
        }));
      }

      res.json({
        periodoActual: periodo,
        monedaActual: monedaFiltro,
        tipoCambio: Number(tipoCambioPeriodo.toFixed(4)),
        filtros: {
          periodos: listaPeriodos.length > 0 ? listaPeriodos : [periodoDefault],
          fechasDisponibles,
          asesores: porAsesor.map((a) => ({
            id: a.idAsesor,
            nombre: a.nombre,
            agencia: a.agencia,
          })),
        },
        kpis: {
          tipoCambio: Number(tipoCambioPeriodo.toFixed(4)),
          saldoAhorros: kpiSaldoAhorrosSoles,
          saldoAhorrosUSD: kpiSaldoAhorrosUSD,
          saldoAhorrosUSD_EnSoles: kpiSaldoAhorrosUSD_EnSoles,
          teaPasivaAhorros: Number(teaPasivaAhorros.toFixed(2)),
          saldoSoloAhorros: kpiSoloAhorrosSoles,
          saldoSoloAhorrosUSD: kpiSoloAhorrosUSD,
          saldoSoloAhorrosUSD_EnSoles: kpiSoloAhorrosUSD_EnSoles,
          teaSoloAhorros: Number(teaSoloAhorros.toFixed(2)),
          saldoSoloAportes: kpiSoloAportesSoles,
          saldoSoloAportesUSD: kpiSoloAportesUSD,
          saldoSoloAportesUSD_EnSoles: kpiSoloAportesUSD_EnSoles,
          teaSoloAportes: Number(teaSoloAportes.toFixed(2)),
          saldoPlazoFijo: kpiSaldoPFSoles,
          saldoPlazoFijoUSD: kpiSaldoPFUSD,
          saldoPlazoFijoUSD_EnSoles: kpiSaldoPFUSD_EnSoles,
          teaPasivaPlazoFijo: Number(teaPasivaPlazoFijo.toFixed(2)),
          saldoCaptacionesTotal,
          saldoCaptacionesUSD: kpiSaldoAhorrosUSD + kpiSaldoPFUSD,
          teaPasivaGlobal: Number(teaPasivaGlobal.toFixed(2)),
          depositosFecha: kpiDepositosSoles,
          depositosFechaUSD: kpiDepositosUSD,
          retirosFecha: kpiRetirosSoles,
          retirosFechaUSD: kpiRetirosUSD,
          flujoNetoAhorros: kpiDepositosSoles - kpiRetirosSoles,
          flujoNetoAhorrosUSD: kpiDepositosUSD - kpiRetirosUSD,
          saldoColocaciones: kpiSaldoColoc,
          teaActivaPonderada: Number(teaActivaPonderada.toFixed(2)),
          spreadFinanciero: Number(spreadFinanciero.toFixed(2)),
          nroCreditos: kpiNroCreditos,
          saldoCaja020: kpiSaldoCaja020,
          saldoCaja020USD: kpiSaldoCaja020USD,
          saldoCaja020USD_EnSoles: kpiSaldoCaja020USD_EnSoles,
          saldoBancos: kpiSaldoBancos,
          saldoBancosUSD: kpiSaldoBancosUSD,
          liquidezTotal: kpiSaldoCaja020 + kpiSaldoBancos,
        },
        porAgencia,
        porAsesor,
        porProductoAhorro,
        porTipoPrestamo,
        bancosManual: bancosRows,
        evolutivo: serieEvolutivaFinal,
        
      });
    } catch (error) {
      console.error("Error en /api/balance-gerencial:", error);
      res.status(500).json({ error: "Error al obtener datos de Balance Gerencial" });
    }
  }
);

// ============================================================================
// POST /api/balance-gerencial/bancos
// ============================================================================
router.post(
  ["/balance-gerencial/bancos", "/api/balance-gerencial/bancos"],
  async (req: Request, res: Response) => {
    try {
      const {
        periodo,
        fechaCorte,
        entidadBancaria = "CONSOLIDADO BANCOS",
        moneda = "MN",
        saldoBanco,
        teaPasivaBanco = 0,
        observacion = "",
        usuarioRegistro = "Gerencia",
      } = req.body;

      const fechaFinal = fechaCorte || new Date().toISOString().split("T")[0];
      const periodoFinal = periodo || fechaFinal.replace(/-/g, "").slice(0, 6);

      const request = pool.request();
      request.input("periodo", sql.VarChar(6), String(periodoFinal).trim());
      request.input("fechaCorte", sql.Date, fechaFinal);
      request.input("entidad", sql.VarChar(100), String(entidadBancaria).trim().toUpperCase());
      request.input("moneda", sql.VarChar(2), String(moneda).trim().toUpperCase());
      request.input("saldo", sql.Decimal(18, 2), Number(saldoBanco || 0));
      request.input("tea", sql.Decimal(10, 4), Number(teaPasivaBanco || 0));
      request.input("obs", sql.NVarChar(300), String(observacion || "").trim());
      request.input("usuario", sql.VarChar(150), String(usuarioRegistro || "Gerencia").trim());

      await request.query(`
        INSERT INTO [DWH_Gestion_Cartera].[dbo].[fct_gerencia_bancos_manual]
          ([Periodo], [Fecha_Corte], [Entidad_Bancaria], [Moneda], [Saldo_Banco], [TEA_Pasiva_Banco], [Observacion], [Usuario_Registro], [Fecha_Actualizacion])
        VALUES
          (@periodo, @fechaCorte, @entidad, @moneda, @saldo, @tea, @obs, @usuario, GETDATE());

        IF EXISTS (SELECT 1 FROM [DWH_Gestion_Cartera].[dbo].[Log_Actualizacion] WHERE [Id] = 6)
          UPDATE [DWH_Gestion_Cartera].[dbo].[Log_Actualizacion] SET [UltimaActualizacion] = GETDATE() WHERE [Id] IN (2, 6);
      `);

      res.json({ ok: true });
    } catch (error) {
      console.error("Error guardando saldo en bancos:", error);
      res.status(500).json({ error: "No se pudo registrar el saldo en bancos" });
    }
  }
);

// ============================================================================
// DELETE /api/balance-gerencial/bancos/:id
// ============================================================================
router.delete(
  ["/balance-gerencial/bancos/:id", "/api/balance-gerencial/bancos/:id"],
  async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const request = pool.request();
      request.input("id", sql.Int, id);
      await request.query(`
        DELETE FROM [DWH_Gestion_Cartera].[dbo].[fct_gerencia_bancos_manual]
        WHERE [Id] = @id;

        IF EXISTS (SELECT 1 FROM [DWH_Gestion_Cartera].[dbo].[Log_Actualizacion] WHERE [Id] = 6)
          UPDATE [DWH_Gestion_Cartera].[dbo].[Log_Actualizacion] SET [UltimaActualizacion] = GETDATE() WHERE [Id] IN (2, 6);
      `);
      res.json({ ok: true });
    } catch (error) {
      console.error("Error eliminando saldo en bancos:", error);
      res.status(500).json({ error: "No se pudo eliminar el registro de banco" });
    }
  }
);

export default router;