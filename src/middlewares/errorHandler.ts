// src/middlewares/errorHandler.ts
import { Request, Response, NextFunction } from 'express';

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
    console.error(`[Error Middleware] Ruta: ${req.method} ${req.originalUrl} | Mensaje:`, err);

    // Si es un error de Timeout por parte de SQL Server
    if (err.code === 'ETIMEOUT' || err.number === -2) {
        return res.status(504).json({
            success: false,
            error: 'Gateway Timeout',
            message: 'La base de datos ha tardado demasiado en responder. Por favor, intente nuevamente en unos momentos.'
        });
    }

    // Si es un error de sintaxis o solicitud inválida en SQL Server
    if (err.code === 'EREQUEST' || err.number === 102) {
        return res.status(400).json({
            success: false,
            error: 'Bad Request',
            message: 'Error en la estructura de la consulta a la base de datos.',
            detail: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }

    // Error general del servidor
    return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'Ocurrió un error interno en el servidor al procesar su solicitud.'
    });
};