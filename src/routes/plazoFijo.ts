// D:\Proyectos\power-bi-web_backend\src\routes\plazoFijo.ts
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

const NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(AGENCY_NAMES).map(([code, name]) => [name.toLowerCase(), code])
);

router.get(
  ["/plazo-fijo", "/api/plazo-fijo"],
  async (req: Request, res: Response) => {
    try {
      const agenciaParam = String(req.query.agencia || "Todas").trim();
      const plazoParam = String(req.query.plazo || "Todas").trim();
      const periodoAperturaParam = String(req.query.periodoApertura || "Todas").trim();
      const periodoVencimientoParam = String(req.query.periodoVencimiento || "Todas").trim();
      // 'SOLO_VIGENTES' (idéntico al Power BI de S/ 4,052,972.70) | 'CONTABLE_TOTAL' (los S/ 41.67M)
      const universoParam = String(req.query.universo || "CONTABLE_TOTAL").toUpperCase().trim();

      let codAgencia = "";
      if (agenciaParam !== "Todas" && agenciaParam !== "") {
        codAgencia =
          NAME_TO_CODE[agenciaParam.toLowerCase()] ||
          agenciaParam.padStart(2, "0");
      }

      const plazoFiltro =
        plazoParam === "Todas" || plazoParam === "Todos" || plazoParam === ""
          ? 0
          : parseInt(plazoParam, 10) || 0;
      const perAperFiltro =
        periodoAperturaParam === "Todas" || periodoAperturaParam === "Todos"
          ? ""
          : periodoAperturaParam;
      const perVencFiltro =
        periodoVencimientoParam === "Todas" || periodoVencimientoParam === "Todos"
          ? ""
          : periodoVencimientoParam;

      // 1. Obtener catálogos de filtros disponibles
      const resCatalogos = await pool.request().query(`
        SELECT DISTINCT [plazo_dias] AS plazo
        FROM (
          SELECT [plazo_dias] FROM [DWH_Gestion_Cartera].[dbo].[fact_plazo_fijo_vigente] WITH (NOLOCK)
          UNION
          SELECT [plazo_dias] FROM [DWH_Gestion_Cartera].[dbo].[fact_plazo_fijo_vencido] WITH (NOLOCK)
        ) P
        WHERE [plazo_dias] IS NOT NULL AND [plazo_dias] > 0
        ORDER BY [plazo_dias] ASC;

        SELECT DISTINCT [periodo_apertura] AS periodo
        FROM (
          SELECT [periodo_apertura] FROM [DWH_Gestion_Cartera].[dbo].[fact_plazo_fijo_vigente] WITH (NOLOCK)
          UNION
          SELECT [periodo_apertura] FROM [DWH_Gestion_Cartera].[dbo].[fact_plazo_fijo_vencido] WITH (NOLOCK)
        ) PA
        WHERE [periodo_apertura] IS NOT NULL AND [periodo_apertura] <> ''
        ORDER BY [periodo_apertura] DESC;

        SELECT DISTINCT [periodo_vencimiento] AS periodo
        FROM (
          SELECT [periodo_vencimiento] FROM [DWH_Gestion_Cartera].[dbo].[fact_plazo_fijo_vigente] WITH (NOLOCK)
          UNION
          SELECT [periodo_vencimiento] FROM [DWH_Gestion_Cartera].[dbo].[fact_plazo_fijo_vencido] WITH (NOLOCK)
        ) PV
        WHERE [periodo_vencimiento] IS NOT NULL AND [periodo_vencimiento] <> ''
        ORDER BY [periodo_vencimiento] DESC;
      `);

      const catSets = resCatalogos.recordsets as any[];
      const plazosDisponibles = (catSets[0] || []).map((r: any) => Number(r.plazo));
      const periodosApertura = (catSets[1] || []).map((r: any) => String(r.periodo).trim());
      const periodosVencimiento = (catSets[2] || []).map((r: any) => String(r.periodo).trim());

      // 2. Consultar Contratos Vigentes
      const reqVig = pool.request();
      reqVig.input("agencia", sql.VarChar(5), codAgencia);
      reqVig.input("plazo", sql.Int, plazoFiltro);
      reqVig.input("perAper", sql.VarChar(10), perAperFiltro);
      reqVig.input("perVenc", sql.VarChar(10), perVencFiltro);
      reqVig.input("soloVigentes", sql.Bit, universoParam === "SOLO_VIGENTES" ? 1 : 0);

      const resVig = await reqVig.query(`
        SELECT
          RIGHT('00' + LTRIM(RTRIM([IdSAgencia])), 2) AS idAgencia,
          RIGHT('000000000000' + LTRIM(RTRIM([cuenta])), 12) AS cuenta,
          LTRIM(RTRIM(ISNULL([nombre_socio], ''))) AS socio,
          RIGHT('000000000000' + LTRIM(RTRIM([contrato])), 12) AS contrato,
          LTRIM(RTRIM(ISNULL([tipo_producto], 'DEPOSITO AZUL'))) AS producto,
          ISNULL([capital], 0) AS capital,
          ISNULL([tea], 0) AS tea,
          ISNULL([interes], 0) AS interes,
          CONVERT(VARCHAR(10), [fecha_apertura], 103) AS fechaApertura,
          ISNULL([plazo_dias], 0) AS plazo,
          CONVERT(VARCHAR(10), [fecha_vencimiento], 103) AS fechaVencimiento,
          ISNULL([periodo_apertura], '') AS periodoApertura,
          ISNULL([periodo_vencimiento], '') AS periodoVencimiento,
          ISNULL([estado_plazo], 'VIGENTE') AS estadoPlazo
        FROM [DWH_Gestion_Cartera].[dbo].[fact_plazo_fijo_vigente] WITH (NOLOCK)
        WHERE (@agencia = '' OR RIGHT('00' + LTRIM(RTRIM([IdSAgencia])), 2) = @agencia)
          AND (@plazo = 0 OR [plazo_dias] = @plazo)
          AND (@perAper = '' OR [periodo_apertura] = @perAper)
          AND (@perVenc = '' OR [periodo_vencimiento] = @perVenc)
          AND (@soloVigentes = 0 OR [estado_plazo] = 'VIGENTE')
        ORDER BY [fecha_apertura] ASC, [contrato] ASC;
      `);

      // 3. Consultar Contratos Vencidos (con teléfonos de contacto)
      const reqVenc = pool.request();
      reqVenc.input("agencia", sql.VarChar(5), codAgencia);
      reqVenc.input("plazo", sql.Int, plazoFiltro);
      reqVenc.input("perAper", sql.VarChar(10), perAperFiltro);
      reqVenc.input("perVenc", sql.VarChar(10), perVencFiltro);

      const resVenc = await reqVenc.query(`
        SELECT TOP 2500
          RIGHT('00' + LTRIM(RTRIM([IdSAgencia])), 2) AS idAgencia,
          RIGHT('000000000000' + LTRIM(RTRIM([cuenta])), 12) AS cuenta,
          LTRIM(RTRIM(ISNULL([nombre_socio], ''))) AS socio,
          RIGHT('000000000000' + LTRIM(RTRIM([contrato])), 12) AS contrato,
          LTRIM(RTRIM(ISNULL([tipo_producto], 'DEPOSITO AZUL'))) AS producto,
          LTRIM(RTRIM(ISNULL([contacto], ''))) AS contacto,
          ISNULL([capital], 0) AS capital,
          ISNULL([tea], 0) AS tea,
          ISNULL([interes], 0) AS interes,
          CONVERT(VARCHAR(10), [fecha_apertura], 103) AS fechaApertura,
          ISNULL([plazo_dias], 0) AS plazo,
          CONVERT(VARCHAR(10), [fecha_vencimiento], 103) AS fechaVencimiento,
          ISNULL([periodo_apertura], '') AS periodoApertura,
          ISNULL([periodo_vencimiento], '') AS periodoVencimiento
        FROM [DWH_Gestion_Cartera].[dbo].[fact_plazo_fijo_vencido] WITH (NOLOCK)
        WHERE (@agencia = '' OR RIGHT('00' + LTRIM(RTRIM([IdSAgencia])), 2) = @agencia)
          AND (@plazo = 0 OR [plazo_dias] = @plazo)
          AND (@perAper = '' OR [periodo_apertura] = @perAper)
          AND (@perVenc = '' OR [periodo_vencimiento] = @perVenc)
        ORDER BY [fecha_vencimiento] DESC, [capital] DESC;
      `);

      const vigentesRows = (resVig.recordset || []).map((r: any) => ({
        ...r,
        agencia: AGENCY_NAMES[r.idAgencia] || `Agencia ${r.idAgencia}`,
        capital: Number(r.capital || 0),
        tea: Number(r.tea || 0),
        interes: Number(r.interes || 0),
        plazo: Number(r.plazo || 0),
      }));

      const vencidosRows = (resVenc.recordset || []).map((r: any) => ({
        ...r,
        agencia: AGENCY_NAMES[r.idAgencia] || `Agencia ${r.idAgencia}`,
        capital: Number(r.capital || 0),
        tea: Number(r.tea || 0),
        interes: Number(r.interes || 0),
        plazo: Number(r.plazo || 0),
      }));

      // 4. Construir Matriz Resumen Jerárquica (Agencia -> Producto -> Plazo) idéntica a Power BI
      const mapAgencia = new Map<string, any>();
      let totalCapitalVig = 0;
      let totalNumTeaVig = 0;
      let totalInteresVig = 0;

      vigentesRows.forEach((r) => {
        totalCapitalVig += r.capital;
        totalNumTeaVig += r.capital * r.tea;
        totalInteresVig += r.interes;

        if (!mapAgencia.has(r.idAgencia)) {
          mapAgencia.set(r.idAgencia, {
            idAgencia: r.idAgencia,
            agencia: r.agencia,
            capitalTotal: 0,
            numTea: 0,
            interesTotal: 0,
            nroContratos: 0,
            productosMap: new Map<string, any>(),
          });
        }
        const agNode = mapAgencia.get(r.idAgencia);
        agNode.capitalTotal += r.capital;
        agNode.numTea += r.capital * r.tea;
        agNode.interesTotal += r.interes;
        agNode.nroContratos += 1;

        if (!agNode.productosMap.has(r.producto)) {
          agNode.productosMap.set(r.producto, {
            producto: r.producto,
            capitalTotal: 0,
            numTea: 0,
            interesTotal: 0,
            nroContratos: 0,
            plazosMap: new Map<number, any>(),
          });
        }
        const prodNode = agNode.productosMap.get(r.producto);
        prodNode.capitalTotal += r.capital;
        prodNode.numTea += r.capital * r.tea;
        prodNode.interesTotal += r.interes;
        prodNode.nroContratos += 1;

        if (!prodNode.plazosMap.has(r.plazo)) {
          prodNode.plazosMap.set(r.plazo, {
            plazo: r.plazo,
            capitalTotal: 0,
            numTea: 0,
            interesTotal: 0,
            nroContratos: 0,
          });
        }
        const plazoNode = prodNode.plazosMap.get(r.plazo);
        plazoNode.capitalTotal += r.capital;
        plazoNode.numTea += r.capital * r.tea;
        plazoNode.interesTotal += r.interes;
        plazoNode.nroContratos += 1;
      });

      const matrizJerarquica = Array.from(mapAgencia.values())
        .map((ag) => ({
          idAgencia: ag.idAgencia,
          agencia: ag.agencia,
          capitalTotal: Number(ag.capitalTotal.toFixed(2)),
          teaPonderada: Number(
            (ag.capitalTotal > 0 ? ag.numTea / ag.capitalTotal : 0).toFixed(2)
          ),
          interesTotal: Number(ag.interesTotal.toFixed(2)),
          nroContratos: ag.nroContratos,
          productos: Array.from(ag.productosMap.values())
            .map((pr: any) => ({
              producto: pr.producto,
              capitalTotal: Number(pr.capitalTotal.toFixed(2)),
              teaPonderada: Number(
                (pr.capitalTotal > 0 ? pr.numTea / pr.capitalTotal : 0).toFixed(2)
              ),
              interesTotal: Number(pr.interesTotal.toFixed(2)),
              nroContratos: pr.nroContratos,
              plazos: Array.from(pr.plazosMap.values())
                .map((pl: any) => ({
                  plazo: pl.plazo,
                  capitalTotal: Number(pl.capitalTotal.toFixed(2)),
                  teaPonderada: Number(
                    (pl.capitalTotal > 0 ? pl.numTea / pl.capitalTotal : 0).toFixed(2)
                  ),
                  interesTotal: Number(pl.interesTotal.toFixed(2)),
                  nroContratos: pl.nroContratos,
                }))
                .sort((a: any, b: any) => b.capitalTotal - a.capitalTotal),
            }))
            .sort((a: any, b: any) => a.producto.localeCompare(b.producto)),
        }))
        .sort((a, b) => b.capitalTotal - a.capitalTotal);

      const totalCapitalVenc = vencidosRows.reduce((s, r) => s + r.capital, 0);
      const totalInteresVenc = vencidosRows.reduce((s, r) => s + r.interes, 0);

      res.json({
        kpis: {
          capitalTotalVigentes: Number(totalCapitalVig.toFixed(2)),
          teaPonderadaVigentes: Number(
            (totalCapitalVig > 0 ? totalNumTeaVig / totalCapitalVig : 0).toFixed(2)
          ),
          interesTotalVigentes: Number(totalInteresVig.toFixed(2)),
          nroContratosVigentes: vigentesRows.length,
          capitalTotalVencidos: Number(totalCapitalVenc.toFixed(2)),
          interesTotalVencidos: Number(totalInteresVenc.toFixed(2)),
          nroContratosVencidos: vencidosRows.length,
        },
        filtros: {
          plazos: plazosDisponibles,
          periodosApertura,
          periodosVencimiento,
        },
        matrizJerarquica,
        vigentes: vigentesRows,
        vencidos: vencidosRows,
      });
    } catch (error) {
      console.error("Error en /api/plazo-fijo:", error);
      res.status(500).json({ error: "Error obteniendo datos de Plazo Fijo" });
    }
  }
);

export default router;