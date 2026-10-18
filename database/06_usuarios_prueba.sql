-- =============================================================
-- Usuarios de prueba (opcional). Ejecutar después de 04 y 05.
-- Se puede ejecutar varias veces: solo agrega los que faltan.
-- Los doctores se ligan a los médicos de 04_datos_prueba.sql por
-- su número de colegiado. NO cargar en producción: cambia las
-- contraseñas o crea usuarios propios con npm run crear-usuario.
--
--   Usuario       Contraseña    Rol     Médico
--   recepcion     recepcion123  admin   —
--   dr.mendez     mendez123     doctor  Dr. Carlos Méndez (10001)
--   dra.ruiz      ruiz12345     doctor  Dra. Ana Ruiz (10002)
--   dr.castillo   castillo123   doctor  Dr. Luis Castillo (10003)
-- =============================================================
USE sistema_citas;

START TRANSACTION;

INSERT INTO usuarios (usuario, nombre, contrasena_hash, rol, medico_id)
SELECT 'recepcion', 'Recepción',
       'scrypt$e9965de888df598f346982ae151b1ac8$d7fdb53a0d86376643ab64b1d44853ae30ba06f7a10a8226f16c78843a5789481bf5beacf6bf3745197fe3584981db4ba3dd84c99752e8275d4a40d0077d07bc',
       'admin', NULL
 WHERE NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.usuario = 'recepcion');

INSERT INTO usuarios (usuario, nombre, contrasena_hash, rol, medico_id)
SELECT v.usuario, m.nombre, v.contrasena_hash, 'doctor', m.id
  FROM (VALUES
    ROW('dr.mendez',   '10001', 'scrypt$6e0fcb902f832e10726e46fec988caf0$45ef6927d16f09e00b4323707fe210d4638ae4187f8f2d623ed460e08f469c7ba7bfad9487893d7f20281501552d8272d2922dbab054ff51523566834d7221ca'),
    ROW('dra.ruiz',    '10002', 'scrypt$51810683a25bfebfb3effbc20b41d1dc$83eb29ca7466dd3b2b2df4159d0ab4e136690c78451da32139969d1983d6c47fdd4cf3ee5ad13bd51b182bbf5b7f9cb7dab6669d7bc9408a75874b9e5e0d1e99'),
    ROW('dr.castillo', '10003', 'scrypt$e360118768d4dcfd8046011dac334232$87baf82afa59c8df815d3984625b8667df1ca323bdfb058dcb1346dc943bfd8002f2917092b408f03439bb1b07898dc2e60516307c978bb853c93c5f568263e9')
  ) AS v (usuario, colegiado, contrasena_hash)
  JOIN medicos m ON m.colegiado = v.colegiado
 WHERE NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.usuario = v.usuario OR u.medico_id = m.id);

COMMIT;
