import bcrypt from 'bcryptjs';

export const DEMO_USERS = [
  { email: 'supervisor@apparelflow.test', password: 'Cutting@123', role: 'cutting_supervisor', full_name: 'Nimali Perera (Cutting Supervisor)' },
  { email: 'verifier@apparelflow.test', password: 'Verify@123', role: 'cutting_verifier', full_name: 'Kasun Silva (Cutting Verifier)' },
  { email: 'sewing@apparelflow.test', password: 'Sewing@123', role: 'sewing_supervisor', full_name: 'Dilani Fernando (Sewing Supervisor)' },
];

const RECIPES = [
  {
    recipe_code: 'REC-BL01', name: 'Casual Blouse', category: 'Blouse', std_fabric_yards: 1.8, wastage_cap: 5.0,
    components: [
      ['Front Body Panel', 1], ['Back Body Panel', 1], ['Sleeves (Left & Right)', 2],
      ['Collar & Stand', 1], ['Sleeve Cuffs', 2],
    ],
  },
  {
    recipe_code: 'REC-CT02', name: 'Crop Top', category: 'Crop Top', std_fabric_yards: 1.1, wastage_cap: 8.0,
    components: [
      ['Front Chest Panel', 1], ['Back Support Panel', 1], ['Neck Binding Strip', 1],
      ['Hem Elastic Casing', 1], ['Side Strap Accents', 2],
    ],
  },
];

/** Idempotent: safe to run on every boot. */
export async function seed(db) {
  for (const u of DEMO_USERS) {
    const exists = await db('users').where({ email: u.email }).first();
    if (!exists) {
      await db('users').insert({
        email: u.email, password_hash: bcrypt.hashSync(u.password, 10), role: u.role, full_name: u.full_name,
      });
    }
  }
  for (const r of RECIPES) {
    let recipe = await db('recipes').where({ recipe_code: r.recipe_code }).first();
    if (!recipe) {
      await db('recipes').insert({
        recipe_code: r.recipe_code, name: r.name, category: r.category,
        std_fabric_yards: r.std_fabric_yards, wastage_cap: r.wastage_cap,
      });
      recipe = await db('recipes').where({ recipe_code: r.recipe_code }).first();
    }
    for (const [component_name, pieces_per_garment] of r.components) {
      const has = await db('recipe_components').where({ recipe_id: recipe.id, component_name }).first();
      if (!has) await db('recipe_components').insert({ recipe_id: recipe.id, component_name, pieces_per_garment, image_url: null });
    }
  }
}