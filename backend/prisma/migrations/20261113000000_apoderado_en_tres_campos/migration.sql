-- Pendiente 22: el apoderado pasa de un texto libre a 3 campos (nombre, DNI y celular).
ALTER TABLE "pacientes" ADD COLUMN "apoderado_dni" VARCHAR(8), ADD COLUMN "apoderado_telefono" VARCHAR(9);

-- Si el texto antiguo traía «Nombre (DNI 12345678, cel. 987654321)», se separa; si no, queda tal cual en el nombre
-- y la recepcionista completa el DNI y el celular al editar al paciente.
UPDATE "pacientes"
SET "apoderado_dni" = substring("apoderado" from 'DNI ([0-9]{8})'),
    "apoderado_telefono" = substring("apoderado" from 'cel\. (9[0-9]{8})'),
    "apoderado" = btrim(regexp_replace("apoderado", '\s*\(DNI [0-9]{8}, cel\. [0-9]{9}\)\s*$', ''))
WHERE "apoderado" ~ '\(DNI [0-9]{8}, cel\. 9[0-9]{8}\)\s*$';
