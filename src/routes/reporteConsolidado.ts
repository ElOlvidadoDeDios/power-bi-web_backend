// D:\Proyectos\power-bi-web_backend\src\routes\reporteConsolidado.ts
import { Router, Request, Response } from "express";

const router = Router();

router.post(
  ["/reporte-consolidado", "/api/reporte-consolidado"],
  async (req: Request, res: Response) => {
    try {
      const baseUrl = (
        process.env.GEODILE_API_BASE_URL || "http://192.168.3.34:8080"
      ).replace(/\/$/, "");
      const token = process.env.GEODILE_API_TOKEN || "";

      const { fecha_ini, fecha_fin, periodo } = req.body || {};

      const upstream = await fetch(
        `${baseUrl}/api_app_dile_v1_1/api/generarReporteConsolidado`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: token } : {}),
          },
          body: JSON.stringify({ fecha_ini, fecha_fin, periodo }),
        }
      );

      const text = await upstream.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        data = {
          status: false,
          count: 0,
          message: text || "Respuesta inválida del servidor origen",
          data: [],
        };
      }

      return res.status(upstream.status).json(data);
    } catch (error: any) {
      console.error("Error en proxy /api/reporte-consolidado:", error);
      return res.status(502).json({
        status: false,
        count: 0,
        message:
          error?.message ||
          "No se pudo conectar con el servidor de Reporte Consolidado (192.168.3.34:8080)",
        data: [],
      });
    }
  }
);

export default router;