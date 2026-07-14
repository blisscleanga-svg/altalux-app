-- Seed data for business_id = 'altalux', extracted from the hardcoded
-- constants previously living in booking/index.html, admin/index.html,
-- technician/index.html (CATEGORIES, WAX_TIER_PRICES, ADDONS_INTERIOR,
-- ADDONS_EXTERIOR, DEPOSIT_RATE, brand colors, Square credentials).

INSERT INTO business_settings (
  business_id, name, phone, city, state, website,
  primary_color, secondary_color, accent_color, background_color,
  deposit_percentage, cancellation_hours, late_fee, cancellation_policy,
  booking_url, admin_url, technician_url,
  square_app_id, square_location_id, square_environment, square_enabled
) VALUES (
  'altalux',
  'AltaLux Mobile Detail',
  '(888) 853-0590',
  'Roswell', 'GA',
  'https://altaluxdetail.com',
  '#104872', '#FF8C00', '#FFAA00', '#0a1628',
  25, 72, 50,
  'A 25% non-refundable deposit is required to confirm your booking. Cancellations or rescheduling with less than 72 hours notice will forfeit the deposit. Our technicians rely on scheduled appointments for their income. Please be aware of your arrival window — if your vehicle is not available within 15 minutes of technician arrival, a $50 late fee will apply.',
  '/booking/', '/admin/', '/technician/',
  'sq0idp-jVMn1EDrut74rDnsRGgZrQ', 'LEWG2XNWRA7BS', 'production', true
)
ON CONFLICT (business_id) DO NOTHING;

-- ===== FULL DETAIL / ESSENTIAL =====
INSERT INTO business_services (business_id, category, package, vehicle_type, price, duration_minutes, description, included_items) VALUES
('altalux','full','essential','Cars/Sedans',208.99,180,
 'Your vehicle gets a thorough refresh inside and out. We start with a complete exterior hand wash, bug splatter removal, dressed tires, and detailed wheels and wheel wells. Inside, we blow out cupholders and crevices, dust all panels and surfaces, apply UV protection to the dashboard, vacuum the interior, and leave every window spotless — inside and out.',
 '{"tier":"small","includesWax":false,"note":"Headliners are delicate and full cleaning can loosen the glue that holds them in place. Headliner cleaning is not included in standard packages. Spot treatment may be available upon request.","included":["Full Exterior Hand Wash","Bug Splatter Removal from Exterior","Tires Dressed","Detail Wheels & Wheel Wells","Interior Compressed Air Blowout of Cupholders & Crevices","Dust Panels, Dashboard, Console & All Interior Surfaces","Dashboard UV Protection Applied","Interior & Exterior Windows Cleaned","Door Jambs Detailed","Interior Vacuumed"]}'::jsonb),
('altalux','full','essential','Mid-Size/Compact SUVs',238.99,180,
 'Your vehicle gets a thorough refresh inside and out. We start with a complete exterior hand wash, bug splatter removal, dressed tires, and detailed wheels and wheel wells. Inside, we blow out cupholders and crevices, dust all panels and surfaces, apply UV protection to the dashboard, vacuum the interior, and leave every window spotless — inside and out.',
 '{"tier":"mid","includesWax":false,"note":"Headliners are delicate and full cleaning can loosen the glue that holds them in place. Headliner cleaning is not included in standard packages. Spot treatment may be available upon request.","included":["Full Exterior Hand Wash","Bug Splatter Removal from Exterior","Tires Dressed","Detail Wheels & Wheel Wells","Interior Compressed Air Blowout of Cupholders & Crevices","Dust Panels, Dashboard, Console & All Interior Surfaces","Dashboard UV Protection Applied","Interior & Exterior Windows Cleaned","Door Jambs Detailed","Interior Vacuumed"]}'::jsonb),
('altalux','full','essential','Small Trucks',268.99,180,
 'Your vehicle gets a thorough refresh inside and out. We start with a complete exterior hand wash, bug splatter removal, dressed tires, and detailed wheels and wheel wells. Inside, we blow out cupholders and crevices, dust all panels and surfaces, apply UV protection to the dashboard, vacuum the interior, and leave every window spotless — inside and out.',
 '{"tier":"mid","includesWax":false,"note":"Headliners are delicate and full cleaning can loosen the glue that holds them in place. Headliner cleaning is not included in standard packages. Spot treatment may be available upon request.","included":["Full Exterior Hand Wash","Bug Splatter Removal from Exterior","Tires Dressed","Detail Wheels & Wheel Wells","Interior Compressed Air Blowout of Cupholders & Crevices","Dust Panels, Dashboard, Console & All Interior Surfaces","Dashboard UV Protection Applied","Interior & Exterior Windows Cleaned","Door Jambs Detailed","Interior Vacuumed"]}'::jsonb),
('altalux','full','essential','Minivans',268.99,180,
 'Your vehicle gets a thorough refresh inside and out. We start with a complete exterior hand wash, bug splatter removal, dressed tires, and detailed wheels and wheel wells. Inside, we blow out cupholders and crevices, dust all panels and surfaces, apply UV protection to the dashboard, vacuum the interior, and leave every window spotless — inside and out.',
 '{"tier":"large","includesWax":false,"note":"Headliners are delicate and full cleaning can loosen the glue that holds them in place. Headliner cleaning is not included in standard packages. Spot treatment may be available upon request.","included":["Full Exterior Hand Wash","Bug Splatter Removal from Exterior","Tires Dressed","Detail Wheels & Wheel Wells","Interior Compressed Air Blowout of Cupholders & Crevices","Dust Panels, Dashboard, Console & All Interior Surfaces","Dashboard UV Protection Applied","Interior & Exterior Windows Cleaned","Door Jambs Detailed","Interior Vacuumed"]}'::jsonb),
('altalux','full','essential','Large SUVs/Trucks',268.99,180,
 'Your vehicle gets a thorough refresh inside and out. We start with a complete exterior hand wash, bug splatter removal, dressed tires, and detailed wheels and wheel wells. Inside, we blow out cupholders and crevices, dust all panels and surfaces, apply UV protection to the dashboard, vacuum the interior, and leave every window spotless — inside and out.',
 '{"tier":"large","includesWax":false,"note":"Headliners are delicate and full cleaning can loosen the glue that holds them in place. Headliner cleaning is not included in standard packages. Spot treatment may be available upon request.","included":["Full Exterior Hand Wash","Bug Splatter Removal from Exterior","Tires Dressed","Detail Wheels & Wheel Wells","Interior Compressed Air Blowout of Cupholders & Crevices","Dust Panels, Dashboard, Console & All Interior Surfaces","Dashboard UV Protection Applied","Interior & Exterior Windows Cleaned","Door Jambs Detailed","Interior Vacuumed"]}'::jsonb);

-- ===== FULL DETAIL / PREMIUM =====
INSERT INTO business_services (business_id, category, package, vehicle_type, price, duration_minutes, description, included_items) VALUES
('altalux','full','premium','Cars/Sedans',288.99,180,
 'Our most comprehensive treatment — everything in the Essential package plus a deeper level of paint and interior care. Ideal for vehicles that need serious restoration or maximum protection.',
 '{"tier":"small","includesWax":true,"note":"Headliners are delicate and full cleaning can loosen the glue that holds them in place. Headliner cleaning is not included in standard packages. Spot treatment may be available upon request.","included":["Full Exterior Hand Wash","Bug Splatter Removal from Exterior","Tires Dressed","Detail Wheels & Wheel Wells","Interior Compressed Air Blowout of Cupholders & Crevices","Dust Panels, Dashboard, Console & All Interior Surfaces","Dashboard UV Protection Applied","Interior & Exterior Windows Cleaned","Door Jambs Detailed","Interior Vacuumed","Machine Applied Wax","Clay Bar Treatment","Carpets & Seats Shampooed","Leather Seats Exfoliated"]}'::jsonb),
('altalux','full','premium','Mid-Size/Compact SUVs',308.99,180,
 'Our most comprehensive treatment — everything in the Essential package plus a deeper level of paint and interior care. Ideal for vehicles that need serious restoration or maximum protection.',
 '{"tier":"mid","includesWax":true,"note":"Headliners are delicate and full cleaning can loosen the glue that holds them in place. Headliner cleaning is not included in standard packages. Spot treatment may be available upon request.","included":["Full Exterior Hand Wash","Bug Splatter Removal from Exterior","Tires Dressed","Detail Wheels & Wheel Wells","Interior Compressed Air Blowout of Cupholders & Crevices","Dust Panels, Dashboard, Console & All Interior Surfaces","Dashboard UV Protection Applied","Interior & Exterior Windows Cleaned","Door Jambs Detailed","Interior Vacuumed","Machine Applied Wax","Clay Bar Treatment","Carpets & Seats Shampooed","Leather Seats Exfoliated"]}'::jsonb),
('altalux','full','premium','Small Trucks',308.99,180,
 'Our most comprehensive treatment — everything in the Essential package plus a deeper level of paint and interior care. Ideal for vehicles that need serious restoration or maximum protection.',
 '{"tier":"mid","includesWax":true,"note":"Headliners are delicate and full cleaning can loosen the glue that holds them in place. Headliner cleaning is not included in standard packages. Spot treatment may be available upon request.","included":["Full Exterior Hand Wash","Bug Splatter Removal from Exterior","Tires Dressed","Detail Wheels & Wheel Wells","Interior Compressed Air Blowout of Cupholders & Crevices","Dust Panels, Dashboard, Console & All Interior Surfaces","Dashboard UV Protection Applied","Interior & Exterior Windows Cleaned","Door Jambs Detailed","Interior Vacuumed","Machine Applied Wax","Clay Bar Treatment","Carpets & Seats Shampooed","Leather Seats Exfoliated"]}'::jsonb),
('altalux','full','premium','Minivans',378.99,180,
 'Our most comprehensive treatment — everything in the Essential package plus a deeper level of paint and interior care. Ideal for vehicles that need serious restoration or maximum protection.',
 '{"tier":"large","includesWax":true,"note":"Headliners are delicate and full cleaning can loosen the glue that holds them in place. Headliner cleaning is not included in standard packages. Spot treatment may be available upon request.","included":["Full Exterior Hand Wash","Bug Splatter Removal from Exterior","Tires Dressed","Detail Wheels & Wheel Wells","Interior Compressed Air Blowout of Cupholders & Crevices","Dust Panels, Dashboard, Console & All Interior Surfaces","Dashboard UV Protection Applied","Interior & Exterior Windows Cleaned","Door Jambs Detailed","Interior Vacuumed","Machine Applied Wax","Clay Bar Treatment","Carpets & Seats Shampooed","Leather Seats Exfoliated"]}'::jsonb),
('altalux','full','premium','Large SUVs/Trucks',378.99,180,
 'Our most comprehensive treatment — everything in the Essential package plus a deeper level of paint and interior care. Ideal for vehicles that need serious restoration or maximum protection.',
 '{"tier":"large","includesWax":true,"note":"Headliners are delicate and full cleaning can loosen the glue that holds them in place. Headliner cleaning is not included in standard packages. Spot treatment may be available upon request.","included":["Full Exterior Hand Wash","Bug Splatter Removal from Exterior","Tires Dressed","Detail Wheels & Wheel Wells","Interior Compressed Air Blowout of Cupholders & Crevices","Dust Panels, Dashboard, Console & All Interior Surfaces","Dashboard UV Protection Applied","Interior & Exterior Windows Cleaned","Door Jambs Detailed","Interior Vacuumed","Machine Applied Wax","Clay Bar Treatment","Carpets & Seats Shampooed","Leather Seats Exfoliated"]}'::jsonb);

-- ===== INTERIOR ONLY =====
INSERT INTO business_services (business_id, category, package, vehicle_type, price, duration_minutes, description, included_items) VALUES
('altalux','interior','interior','Cars/Sedans',239.99,180,
 'A focused deep-dive into your vehicle''s cabin. From steam-cleaned vents to shampooed carpets, every interior surface is treated with professional-grade products and restored to its best condition.',
 '{"tier":"small","includesWax":false,"note":null,"included":["Full Interior Blowout with Compressed Air","Vacuum of Seats, Mats, Cracks, Crevices & Trunk Space","Deep Carpet and Cloth Seats Shampooed (or Leather Seats Scrubbed)","Carpet Mats Shampooed, All-Weather/Rubber Mats Cleaned & Protected","Interior Panels, Console, and Dashboard Deep-Cleaned","Steam Cleaning of Interior Panels & Vents (as needed)","Air Vents Blown Out and Detailed","Streak-Free Window Cleaning – Inside & Out","Door and Trunk/Cargo Jambs Wiped & Detailed","Vanity + Rearview Mirrors Cleaned","Center Console Detailed"]}'::jsonb),
('altalux','interior','interior','Compact/Mid-Size SUV',264.99,180,
 'A focused deep-dive into your vehicle''s cabin. From steam-cleaned vents to shampooed carpets, every interior surface is treated with professional-grade products and restored to its best condition.',
 '{"tier":"mid","includesWax":false,"note":null,"included":["Full Interior Blowout with Compressed Air","Vacuum of Seats, Mats, Cracks, Crevices & Trunk Space","Deep Carpet and Cloth Seats Shampooed (or Leather Seats Scrubbed)","Carpet Mats Shampooed, All-Weather/Rubber Mats Cleaned & Protected","Interior Panels, Console, and Dashboard Deep-Cleaned","Steam Cleaning of Interior Panels & Vents (as needed)","Air Vents Blown Out and Detailed","Streak-Free Window Cleaning – Inside & Out","Door and Trunk/Cargo Jambs Wiped & Detailed","Vanity + Rearview Mirrors Cleaned","Center Console Detailed"]}'::jsonb),
('altalux','interior','interior','Small Truck',264.99,180,
 'A focused deep-dive into your vehicle''s cabin. From steam-cleaned vents to shampooed carpets, every interior surface is treated with professional-grade products and restored to its best condition.',
 '{"tier":"mid","includesWax":false,"note":null,"included":["Full Interior Blowout with Compressed Air","Vacuum of Seats, Mats, Cracks, Crevices & Trunk Space","Deep Carpet and Cloth Seats Shampooed (or Leather Seats Scrubbed)","Carpet Mats Shampooed, All-Weather/Rubber Mats Cleaned & Protected","Interior Panels, Console, and Dashboard Deep-Cleaned","Steam Cleaning of Interior Panels & Vents (as needed)","Air Vents Blown Out and Detailed","Streak-Free Window Cleaning – Inside & Out","Door and Trunk/Cargo Jambs Wiped & Detailed","Vanity + Rearview Mirrors Cleaned","Center Console Detailed"]}'::jsonb),
('altalux','interior','interior','Large SUV/3rd Row SUVs',284.99,180,
 'A focused deep-dive into your vehicle''s cabin. From steam-cleaned vents to shampooed carpets, every interior surface is treated with professional-grade products and restored to its best condition.',
 '{"tier":"large","includesWax":false,"note":null,"included":["Full Interior Blowout with Compressed Air","Vacuum of Seats, Mats, Cracks, Crevices & Trunk Space","Deep Carpet and Cloth Seats Shampooed (or Leather Seats Scrubbed)","Carpet Mats Shampooed, All-Weather/Rubber Mats Cleaned & Protected","Interior Panels, Console, and Dashboard Deep-Cleaned","Steam Cleaning of Interior Panels & Vents (as needed)","Air Vents Blown Out and Detailed","Streak-Free Window Cleaning – Inside & Out","Door and Trunk/Cargo Jambs Wiped & Detailed","Vanity + Rearview Mirrors Cleaned","Center Console Detailed"]}'::jsonb),
('altalux','interior','interior','Large Truck',284.99,180,
 'A focused deep-dive into your vehicle''s cabin. From steam-cleaned vents to shampooed carpets, every interior surface is treated with professional-grade products and restored to its best condition.',
 '{"tier":"large","includesWax":false,"note":null,"included":["Full Interior Blowout with Compressed Air","Vacuum of Seats, Mats, Cracks, Crevices & Trunk Space","Deep Carpet and Cloth Seats Shampooed (or Leather Seats Scrubbed)","Carpet Mats Shampooed, All-Weather/Rubber Mats Cleaned & Protected","Interior Panels, Console, and Dashboard Deep-Cleaned","Steam Cleaning of Interior Panels & Vents (as needed)","Air Vents Blown Out and Detailed","Streak-Free Window Cleaning – Inside & Out","Door and Trunk/Cargo Jambs Wiped & Detailed","Vanity + Rearview Mirrors Cleaned","Center Console Detailed"]}'::jsonb);

-- ===== EXTERIOR ONLY =====
INSERT INTO business_services (business_id, category, package, vehicle_type, price, duration_minutes, description, included_items) VALUES
('altalux','exterior','exterior','Car',159.99,180,
 'A precise exterior treatment that protects your paint and restores your vehicle''s shine — without touching the interior.',
 '{"tier":"small","includesWax":true,"note":null,"included":["Full Exterior Hand Wash","Bug Removal","Iron Remover Treatment","Tires Dressed","Detail Wheels & Wheel Wells","Exterior Windows Cleaned","Machine Applied Wax","Clay Bar","Paint Sealant Applied"]}'::jsonb),
('altalux','exterior','exterior','Compact/Midsize SUV',189.99,180,
 'A precise exterior treatment that protects your paint and restores your vehicle''s shine — without touching the interior.',
 '{"tier":"mid","includesWax":true,"note":null,"included":["Full Exterior Hand Wash","Bug Removal","Iron Remover Treatment","Tires Dressed","Detail Wheels & Wheel Wells","Exterior Windows Cleaned","Machine Applied Wax","Clay Bar","Paint Sealant Applied"]}'::jsonb),
('altalux','exterior','exterior','Truck',189.99,180,
 'A precise exterior treatment that protects your paint and restores your vehicle''s shine — without touching the interior.',
 '{"tier":"mid","includesWax":true,"note":null,"included":["Full Exterior Hand Wash","Bug Removal","Iron Remover Treatment","Tires Dressed","Detail Wheels & Wheel Wells","Exterior Windows Cleaned","Machine Applied Wax","Clay Bar","Paint Sealant Applied"]}'::jsonb),
('altalux','exterior','exterior','Minivan',189.99,180,
 'A precise exterior treatment that protects your paint and restores your vehicle''s shine — without touching the interior.',
 '{"tier":"large","includesWax":true,"note":null,"included":["Full Exterior Hand Wash","Bug Removal","Iron Remover Treatment","Tires Dressed","Detail Wheels & Wheel Wells","Exterior Windows Cleaned","Machine Applied Wax","Clay Bar","Paint Sealant Applied"]}'::jsonb),
('altalux','exterior','exterior','Large/XL SUV',219.99,180,
 'A precise exterior treatment that protects your paint and restores your vehicle''s shine — without touching the interior.',
 '{"tier":"large","includesWax":true,"note":null,"included":["Full Exterior Hand Wash","Bug Removal","Iron Remover Treatment","Tires Dressed","Detail Wheels & Wheel Wells","Exterior Windows Cleaned","Machine Applied Wax","Clay Bar","Paint Sealant Applied"]}'::jsonb),
('altalux','exterior','exterior','XL SUV, Truck or Van',244.99,180,
 'A precise exterior treatment that protects your paint and restores your vehicle''s shine — without touching the interior.',
 '{"tier":"large","includesWax":true,"note":null,"included":["Full Exterior Hand Wash","Bug Removal","Iron Remover Treatment","Tires Dressed","Detail Wheels & Wheel Wells","Exterior Windows Cleaned","Machine Applied Wax","Clay Bar","Paint Sealant Applied"]}'::jsonb);

-- ===== ADD-ONS: interior =====
INSERT INTO business_addons (business_id, name, price, price_varies, description, category) VALUES
('altalux','Pet Hair Removal',50.00,true,'Final price may vary','interior'),
('altalux','Leather Seat Conditioning',50.00,false,null,'interior'),
('altalux','New Car Smell Air Cabin Treatment',50.00,false,null,'interior'),
('altalux','UV Protective Dressing – Interior Plastics',50.00,false,null,'interior'),
('altalux','Ozone Treatment',125.00,false,null,'interior');

-- ===== ADD-ONS: exterior =====
INSERT INTO business_addons (business_id, name, price, price_varies, description, category) VALUES
('altalux','Sap/Tar Removal',75.00,true,'Final price may vary','exterior'),
('altalux','Black Trim Restoration',125.00,false,null,'exterior');

-- ===== ADD-ONS: Machine Applied Wax, priced by vehicle tier =====
-- (kept as addons with category='machine_wax_tier'; config.js exposes
--  APP_CONFIG.getWaxPrice(tier) to look these up by tier suffix)
INSERT INTO business_addons (business_id, name, price, price_varies, description, category) VALUES
('altalux','Machine Applied Wax - Small',50.00,false,'Vehicle tier: small','machine_wax_tier'),
('altalux','Machine Applied Wax - Mid',60.00,false,'Vehicle tier: mid','machine_wax_tier'),
('altalux','Machine Applied Wax - Large',70.00,false,'Vehicle tier: large','machine_wax_tier');
