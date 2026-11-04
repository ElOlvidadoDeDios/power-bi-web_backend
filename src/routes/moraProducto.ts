// D:\Proyectos\power-bi-web_backend\src\routes\moraProducto.ts
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
  ["/mora-producto", "/api/mora-producto"],
  async (req: Request, res: Response) => {
    try {
      const d = new Date();
      const defaultPer = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
      const periodo = String(req.query.periodo || defaultPer).trim();
      const agenciaParam = String(req.query.agencia || "Todas").trim();
      const areaParam = String(req.query.area || "COMERCIAL").toUpperCase().trim(); // 'COMERCIAL' | 'RECUPERACION' | 'TODAS'
      const productoParam = String(req.query.producto || "Todos").trim();

      let codAgencia = "";
      if (agenciaParam !== "Todas" && agenciaParam !== "") {
        codAgencia =
          NAME_TO_CODE[agenciaParam.toLowerCase()] ||
          agenciaParam.padStart(2, "0");
      }

      const areaFiltro =
        areaParam === "TODAS" || areaParam === "TOTAL" ? "" : areaParam;
      const prodFiltro =
        productoParam === "Todos" || productoParam === "Todas" ? "" : productoParam;

      // 1. Catálogo de Productos disponibles en el periodo
      const reqCat = pool.request();
      reqCat.input("periodo", sql.VarChar(6), periodo);
      reqCat.input("area", sql.VarChar(20), areaFiltro);
      const resCat = await reqCat.query(`
        SELECT
          [Cod_Producto] AS codigo,
          MAX([Producto]) AS producto,
          MAX([Tipo_Prestamo]) AS tipoPrestamo,
          SUM([Cartera_Producto]) AS carteraTotal
        FROM [DWH_Gestion_Cartera].[dbo].[fct_mora_por_producto] WITH (NOLOCK)
        WHERE [Periodo] = @periodo
          AND (@area = '' OR [Area_Cartera] = @area)
        GROUP BY [Cod_Producto]
        ORDER BY SUM([Mora_CPP_4]) DESC;
      `);

      // 2. Datos del Periodo Seleccionado (Agencia x Producto)
      const reqData = pool.request();
      reqData.input("periodo", sql.VarChar(6), periodo);
      reqData.input("agencia", sql.VarChar(5), codAgencia);
      reqData.input("area", sql.VarChar(20), areaFiltro);
      reqData.input("producto", sql.VarChar(100), prodFiltro);

      const resData = await reqData.query(`
        SELECT
          [Periodo],
          [IdSAgencia],
          [Area_Cartera],
          [Cod_Tipo_Pres],
          MAX([Tipo_Prestamo]) AS Tipo_Prestamo,
          [Cod_Producto],
          MAX([Producto]) AS Producto,
          SUM([Nro_Creditos]) AS Nro_Creditos,
          SUM([Nro_Socios]) AS Nro_Socios,
          SUM([Cartera_Producto]) AS Cartera,
          SUM([Mora_1_Dia]) AS Mora_1_Dia,
          SUM([Mora_CPP_4]) AS Mora_CPP,
          SUM([Mora_Deficiente_31]) AS Mora_Deficiente,
          SUM([Mora_150]) AS Mora_150,
          SUM([Cred_Mora_1_Dia]) AS Cred_Mora_1_Dia,
          SUM([Cred_Mora_CPP_4]) AS Cred_Mora_CPP,
          SUM([Cred_Mora_Def_31]) AS Cred_Mora_Deficiente,
          SUM([Cred_Mora_150]) AS Cred_Mora_150,
          SUM([Tramo_Al_Dia]) AS Tramo_Al_Dia,
          SUM([Tramo_1_a_3]) AS Tramo_1_a_3,
          SUM([Tramo_4_a_8]) AS Tramo_4_a_8,
          SUM([Tramo_9_a_30]) AS Tramo_9_a_30,
          SUM([Tramo_31_a_150]) AS Tramo_31_a_150,
          SUM([Tramo_Mas_150]) AS Tramo_Mas_150,
          SUM([SBS_Normal]) AS SBS_Normal,
          SUM([SBS_CPP]) AS SBS_CPP,
          SUM([SBS_Deficiente]) AS SBS_Deficiente,
          SUM([SBS_Dudoso]) AS SBS_Dudoso,
          SUM([SBS_Perdida]) AS SBS_Perdida
        FROM [DWH_Gestion_Cartera].[dbo].[fct_mora_por_producto] WITH (NOLOCK)
        WHERE [Periodo] = @periodo
          AND (@agencia = '' OR [IdSAgencia] = @agencia)
          AND (@area = '' OR [Area_Cartera] = @area)
          AND (@producto = '' OR [Cod_Producto] = @producto OR [Producto] = @producto)
        GROUP BY
          [Periodo],
          [IdSAgencia],
          [Area_Cartera],
          [Cod_Tipo_Pres],
          [Cod_Producto];
      `);

      // 3. Línea de Tiempo Evolutiva por Periodo (filtrada por Agencia, Área y Producto)
      const reqEvo = pool.request();
      reqEvo.input("agencia", sql.VarChar(5), codAgencia);
      reqEvo.input("area", sql.VarChar(20), areaFiltro);
      reqEvo.input("producto", sql.VarChar(100), prodFiltro);

      const resEvo = await reqEvo.query(`
        SELECT TOP 12
          [Periodo] AS periodo,
          SUM([Nro_Creditos]) AS nroCreditos,
          SUM([Cartera_Producto]) AS cartera,
          SUM([Mora_1_Dia]) AS mora1Dia,
          SUM([Mora_CPP_4]) AS moraCpp,
          SUM([Mora_Deficiente_31]) AS moraDeficiente,
          SUM([Mora_150]) AS mora150,
          SUM([Tramo_1_a_3]) AS tramo1a3,
          SUM([Tramo_4_a_8]) AS tramo4a8,
          SUM([Tramo_9_a_30]) AS tramo9a30,
          SUM([Tramo_31_a_150]) AS tramo31a150
        FROM [DWH_Gestion_Cartera].[dbo].[fct_mora_por_producto] WITH (NOLOCK)
        WHERE (@agencia = '' OR [IdSAgencia] = @agencia)
          AND (@area = '' OR [Area_Cartera] = @area)
          AND (@producto = '' OR [Cod_Producto] = @producto OR [Producto] = @producto)
        GROUP BY [Periodo]
        ORDER BY [Periodo] ASC;
      `);

      const rows = resData.recordset || [];
      const evoRaw = resEvo.recordset || [];

      // Consolidar KPIs Globales, Por Producto, Por Agencia y Agencia x Producto
      let totalCartera = 0;
      let totalCreditos = 0;
      let totalSocios = 0;
      let totalMora1Dia = 0;
      let totalMoraCpp = 0;
      let totalMoraDef = 0;
      let totalMora150 = 0;
      let totalAlDia = 0;
      let totalT1_3 = 0;
      let totalT4_8 = 0;
      let totalT9_30 = 0;
      let totalT31_150 = 0;

      const mapProducto = new Map<string, any>();
      const mapAgencia = new Map<string, any>();
      const listAgenciaProducto: any[] = [];

      rows.forEach((r: any) => {
        const codAge = String(r.IdSAgencia || "01").trim().padStart(2, "0");
        const nomAge = AGENCY_NAMES[codAge] || `Agencia ${codAge}`;
        const codProd = String(r.Cod_Producto || "00").trim();
        const nomProd = String(r.Producto || "SIN PRODUCTO").trim();
        const nomTipoPres = String(r.Tipo_Prestamo || "").trim();

        const cartera = Number(r.Cartera || 0);
        const creditos = Number(r.Nro_Creditos || 0);
        const socios = Number(r.Nro_Socios || 0);
        const m1 = Number(r.Mora_1_Dia || 0);
        const mCpp = Number(r.Mora_CPP || 0);
        const mDef = Number(r.Mora_Deficiente || 0);
        const m150 = Number(r.Mora_150 || 0);

        const c1 = Number(r.Cred_Mora_1_Dia || 0);
        const cCpp = Number(r.Cred_Mora_CPP || 0);
        const cDef = Number(r.Cred_Mora_Deficiente || 0);
        const c150 = Number(r.Cred_Mora_150 || 0);

        const t0 = Number(r.Tramo_Al_Dia || 0);
        const t1_3 = Number(r.Tramo_1_a_3 || 0);
        const t4_8 = Number(r.Tramo_4_a_8 || 0);
        const t9_30 = Number(r.Tramo_9_a_30 || 0);
        const t31_150 = Number(r.Tramo_31_a_150 || 0);
        const tMas150 = Number(r.Tramo_Mas_150 || 0);

        totalCartera += cartera;
        totalCreditos += creditos;
        totalSocios += socios;
        totalMora1Dia += m1;
        totalMoraCpp += mCpp;
        totalMoraDef += mDef;
        totalMora150 += m150;
        totalAlDia += t0;
        totalT1_3 += t1_3;
        totalT4_8 += t4_8;
        totalT9_30 += t9_30;
        totalT31_150 += t31_150;

        // 1. Acumular por Producto
        if (!mapProducto.has(codProd)) {
          mapProducto.set(codProd, {
            codProducto: codProd,
            producto: nomProd,
            tipoPrestamo: nomTipoPres,
            nroCreditos: 0,
            nroSocios: 0,
            cartera: 0,
            mora1Dia: 0,
            moraCpp: 0,
            moraDeficiente: 0,
            mora150: 0,
            credMora1Dia: 0,
            credMoraCpp: 0,
            credMoraDef: 0,
            credMora150: 0,
            tramoAlDia: 0,
            tramo1a3: 0,
            tramo4a8: 0,
            tramo9a30: 0,
            tramo31a150: 0,
            tramoMas150: 0,
          });
        }
        const p = mapProducto.get(codProd);
        p.nroCreditos += creditos;
        p.nroSocios += socios;
        p.cartera += cartera;
        p.mora1Dia += m1;
        p.moraCpp += mCpp;
        p.moraDeficiente += mDef;
        p.mora150 += m150;
        p.credMora1Dia += c1;
        p.credMoraCpp += cCpp;
        p.credMoraDef += cDef;
        p.credMora150 += c150;
        p.tramoAlDia += t0;
        p.tramo1a3 += t1_3;
        p.tramo4a8 += t4_8;
        p.tramo9a30 += t9_30;
        p.tramo31a150 += t31_150;
        p.tramoMas150 += tMas150;

        // 2. Acumular por Agencia
        if (!mapAgencia.has(codAge)) {
          mapAgencia.set(codAge, {
            idAgencia: codAge,
            agencia: nomAge,
            nroCreditos: 0,
            nroSocios: 0,
            cartera: 0,
            mora1Dia: 0,
            moraCpp: 0,
            moraDeficiente: 0,
            mora150: 0,
            tramoAlDia: 0,
            tramo1a3: 0,
            tramo4a8: 0,
            tramo9a30: 0,
            tramo31a150: 0,
            tramoMas150: 0,
          });
        }
        const ag = mapAgencia.get(codAge);
        ag.nroCreditos += creditos;
        ag.nroSocios += socios;
        ag.cartera += cartera;
        ag.mora1Dia += m1;
        ag.moraCpp += mCpp;
        ag.moraDeficiente += mDef;
        ag.mora150 += m150;
        ag.tramoAlDia += t0;
        ag.tramo1a3 += t1_3;
        ag.tramo4a8 += t4_8;
        ag.tramo9a30 += t9_30;
        ag.tramo31a150 += t31_150;
        ag.tramoMas150 += tMas150;

        // 3. Fila Agencia x Producto
        listAgenciaProducto.push({
          idAgencia: codAge,
          agencia: nomAge,
          area: r.Area_Cartera,
          codProducto: codProd,
          producto: nomProd,
          tipoPrestamo: nomTipoPres,
          nroCreditos: creditos,
          nroSocios: socios,
          cartera,
          mora1Dia: m1,
          pctMora1Dia: cartera > 0 ? Number(((m1 / cartera) * 100).toFixed(2)) : 0,
          moraCpp: mCpp,
          pctMoraCpp: cartera > 0 ? Number(((mCpp / cartera) * 100).toFixed(2)) : 0,
          moraDeficiente: mDef,
          pctMoraDeficiente: cartera > 0 ? Number(((mDef / cartera) * 100).toFixed(2)) : 0,
          mora150: m150,
          pctMora150: cartera > 0 ? Number(((m150 / cartera) * 100).toFixed(2)) : 0,
          tramoAlDia: t0,
          tramo1a3: t1_3,
          tramo4a8: t4_8,
          tramo9a30: t9_30,
          tramo31a150: t31_150,
          tramoMas150: tMas150,
        });
      });

      const porProducto = Array.from(mapProducto.values())
        .map((p) => ({
          ...p,
          pctCarteraShare:
            totalCartera > 0 ? Number(((p.cartera / totalCartera) * 100).toFixed(2)) : 0,
          pctMora1Dia:
            p.cartera > 0 ? Number(((p.mora1Dia / p.cartera) * 100).toFixed(2)) : 0,
          pctMoraCpp:
            p.cartera > 0 ? Number(((p.moraCpp / p.cartera) * 100).toFixed(2)) : 0,
          pctShareMoraCpp:
            totalMoraCpp > 0 ? Number(((p.moraCpp / totalMoraCpp) * 100).toFixed(2)) : 0,
          pctMoraDeficiente:
            p.cartera > 0 ? Number(((p.moraDeficiente / p.cartera) * 100).toFixed(2)) : 0,
          pctShareMoraDef:
            totalMoraDef > 0 ? Number(((p.moraDeficiente / totalMoraDef) * 100).toFixed(2)) : 0,
          pctMora150:
            p.cartera > 0 ? Number(((p.mora150 / p.cartera) * 100).toFixed(2)) : 0,
        }))
        .sort((a, b) => b.moraCpp - a.moraCpp);

      const porAgencia = Array.from(mapAgencia.values())
        .map((a) => ({
          ...a,
          pctMora1Dia:
            a.cartera > 0 ? Number(((a.mora1Dia / a.cartera) * 100).toFixed(2)) : 0,
          pctMoraCpp:
            a.cartera > 0 ? Number(((a.moraCpp / a.cartera) * 100).toFixed(2)) : 0,
          pctShareMoraCpp:
            totalMoraCpp > 0 ? Number(((a.moraCpp / totalMoraCpp) * 100).toFixed(2)) : 0,
          pctMoraDeficiente:
            a.cartera > 0 ? Number(((a.moraDeficiente / a.cartera) * 100).toFixed(2)) : 0,
          pctMora150:
            a.cartera > 0 ? Number(((a.mora150 / a.cartera) * 100).toFixed(2)) : 0,
        }))
        .sort((a, b) => a.idAgencia.localeCompare(b.idAgencia));

      listAgenciaProducto.sort((a, b) => {
        if (a.idAgencia !== b.idAgencia) return a.idAgencia.localeCompare(b.idAgencia);
        return b.moraCpp - a.moraCpp;
      });

      const evolutivo = evoRaw.map((e: any) => {
        const c = Number(e.cartera || 0);
        const m1 = Number(e.mora1Dia || 0);
        const mCpp = Number(e.moraCpp || 0);
        const mDef = Number(e.moraDeficiente || 0);
        const m150 = Number(e.mora150 || 0);
        return {
          periodo: String(e.periodo).trim(),
          nroCreditos: Number(e.nroCreditos || 0),
          cartera: c,
          mora1Dia: m1,
          moraCpp: mCpp,
          moraDeficiente: mDef,
          mora150: m150,
          pctMora1Dia: c > 0 ? Number(((m1 / c) * 100).toFixed(2)) : 0,
          pctMoraCpp: c > 0 ? Number(((mCpp / c) * 100).toFixed(2)) : 0,
          pctMoraDeficiente: c > 0 ? Number(((mDef / c) * 100).toFixed(2)) : 0,
          pctMora150: c > 0 ? Number(((m150 / c) * 100).toFixed(2)) : 0,
          tramo1a3: Number(e.tramo1a3 || 0),
          tramo4a8: Number(e.tramo4a8 || 0),
          tramo9a30: Number(e.tramo9a30 || 0),
          tramo31a150: Number(e.tramo31a150 || 0),
        };
      });

      res.json({
        periodo,
        area: areaParam,
        agencia: agenciaParam,
        producto: productoParam,
        catalogoProductos: resCat.recordset || [],
        kpis: {
          carteraTotal: totalCartera,
          nroCreditos: totalCreditos,
          nroSocios: totalSocios,
          mora1Dia: totalMora1Dia,
          pctMora1Dia:
            totalCartera > 0 ? Number(((totalMora1Dia / totalCartera) * 100).toFixed(2)) : 0,
          moraCpp: totalMoraCpp,
          pctMoraCpp:
            totalCartera > 0 ? Number(((totalMoraCpp / totalCartera) * 100).toFixed(2)) : 0,
          moraDeficiente: totalMoraDef,
          pctMoraDeficiente:
            totalCartera > 0 ? Number(((totalMoraDef / totalCartera) * 100).toFixed(2)) : 0,
          mora150: totalMora150,
          pctMora150:
            totalCartera > 0 ? Number(((totalMora150 / totalCartera) * 100).toFixed(2)) : 0,
          tramoAlDia: totalAlDia,
          tramo1a3: totalT1_3,
          tramo4a8: totalT4_8,
          tramo9a30: totalT9_30,
          tramo31a150: totalT31_150,
        },
        porProducto,
        porAgencia,
        porAgenciaProducto: listAgenciaProducto,
        evolutivo,
      });
    } catch (error) {
      console.error("Error en /api/mora-producto:", error);
      res.status(500).json({ error: "Error al obtener Mora por Producto" });
    }
  }
);

export default router;