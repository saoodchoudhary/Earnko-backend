const mongoose = require('mongoose');
require('dotenv').config();
const CategoryCommission = require('../models/CategoryCommission');

const seedData = [
  { categoryKey: 'BGM', label: 'Books & General Merchandise', commissionRate: 4, commissionType: 'percentage', maxCap: null },
  { categoryKey: 'Home', label: 'Home', commissionRate: 3, commissionType: 'percentage', maxCap: null },
  { categoryKey: 'LargeAppliances', label: 'Large Appliances', commissionRate: 3, commissionType: 'percentage', maxCap: 200 },
  { categoryKey: 'CoreElectronics', label: 'Core Electronics', commissionRate: 3, commissionType: 'percentage', maxCap: 200 },
  { categoryKey: 'EmergingElectronics', label: 'Emerging Electronics', commissionRate: 3, commissionType: 'percentage', maxCap: 200 },
  { categoryKey: 'FashionMens', label: 'Fashion & Lifestyle (Mens)', commissionRate: 10, commissionType: 'percentage', maxCap: 30 },
  { categoryKey: 'FashionOther', label: 'Fashion & Lifestyle (Other)', commissionRate: 3, commissionType: 'percentage', maxCap: null },
  { categoryKey: 'Furniture', label: 'Furniture', commissionRate: 3, commissionType: 'percentage', maxCap: null },
  { categoryKey: 'MobileTierA', label: 'Mobile Tier A', commissionRate: 1, commissionType: 'percentage', maxCap: 100 },
  { categoryKey: 'MobileTierB', label: 'Mobile Tier B', commissionRate: 0.5, commissionType: 'percentage', maxCap: 100 },
  { categoryKey: 'MobileTierC', label: 'Mobile Tier C', commissionRate: 0, commissionType: 'percentage', maxCap: 0 },
  { categoryKey: 'OtherMobiles', label: 'Any Other Mobile Phones', commissionRate: 0, commissionType: 'percentage', maxCap: 0 },
  { categoryKey: 'Grocery', label: 'Grocery', commissionRate: 4, commissionType: 'percentage', maxCap: null }
];

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  for (const item of seedData) {
    const exists = await CategoryCommission.findOne({ store: null, categoryKey: item.categoryKey });
    if (exists) {
      await CategoryCommission.updateOne({ _id: exists._id }, { $set: item });
      console.log('Updated', item.categoryKey);
    } else {
      await CategoryCommission.create(item);
      console.log('Created', item.categoryKey);
    }
  }
  console.log('Seeding done');
  process.exit(0);
}
seed();