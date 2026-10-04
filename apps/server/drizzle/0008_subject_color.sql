ALTER TABLE `subjects` ADD `color` integer;--> statement-breakpoint
-- Bestehende Fächer bekommen reihum eine Farbe (nach Position), das eingebaute Fach „Standard“ bleibt neutral.
UPDATE `subjects` SET `color` = (
  SELECT COUNT(*) FROM `subjects` AS `other`
  WHERE `other`.`kind` <> 'default'
    AND (`other`.`position` < `subjects`.`position`
      OR (`other`.`position` = `subjects`.`position` AND `other`.`rowid` < `subjects`.`rowid`))
) % 8
WHERE `kind` <> 'default';
