const Hotel = require("../models/Hotel");
const Staff = require("../models/Staff");
const Review = require("../models/Review");
const Ticket = require("../models/Ticket");
const bcrypt = require("bcryptjs");

// ═══════════════════════════════════════════
//  BUSINESSES (Hotels)
// ═══════════════════════════════════════════

exports.getBusinesses = async (req, res, next) => {
  try {
    let query = {};

    // Build query based on user role
    if (req.user.role === "superadmin") {
      // Superadmin sees all except their own hotel
      query = req.user.hotel_id ? { _id: { $ne: req.user.hotel_id } } : {};
    } else if (req.user.role === "owner" || req.user.role === "property_manager") {
      // Owner/Property Manager see only their business
      const staff = await Staff.findById(req.user.id);
      if (staff?.business_id) {
        query = { _id: staff.business_id };
      } else {
        return res.json({ success: true, data: [] });
      }
    } else {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const businesses = await Hotel.find(query).lean();

    // Enrich with property counts and review counts
    const enriched = await Promise.all(
      businesses.map(async (biz) => {
        const reviewCount = await Review.countDocuments({ hotel_id: biz._id });
        const staffCount = await Staff.countDocuments({ hotelId: biz._id });
        const owner = await Staff.findOne({ hotelId: biz._id, role: { $in: ["gm", "superadmin"] } }).select("name email");
        return {
          _id: biz._id,
          hotel_name: biz.hotel_name,
          city: biz.city,
          number_of_rooms: biz.number_of_rooms,
          propertyCount: (biz.properties || []).length,
          reviewCount,
          staffCount,
          owner: owner ? { name: owner.name, email: owner.email } : null,
          createdAt: biz.createdAt || biz._id.getTimestamp(),
          is_active: biz.is_active !== false
        };
      })
    );

    res.json({ success: true, data: enriched });
  } catch (err) {
    next(err);
  }
};

exports.addBusiness = async (req, res, next) => {
  try {
    const { hotel_name, city, number_of_rooms, admin_name, admin_email, admin_password } = req.body;

    if (!hotel_name || !admin_email || !admin_password) {
      return res.status(400).json({ success: false, message: "Business name, admin email, and password are required" });
    }

    if (!number_of_rooms || isNaN(number_of_rooms)) {
      return res.status(400).json({ success: false, message: "Number of rooms is required" });
    }

    // Check if admin email already exists
    const existing = await Staff.findOne({ email: admin_email });
    if (existing) {
      return res.status(400).json({ success: false, message: "An account with this email already exists" });
    }

    // Create the business (hotel)
    const hotel = new Hotel({
      hotel_name: hotel_name.trim(),
      city: city?.trim() || "",
      number_of_rooms: parseInt(number_of_rooms),
      properties: []
    });
    await hotel.save();

    // Create admin staff for this business
    const hashedPassword = await bcrypt.hash(admin_password, 10);
    const staff = new Staff({
      name: admin_name || hotel_name,
      email: admin_email,
      password: hashedPassword,
      role: "gm",
      hotelId: hotel._id,
      avatar_initials: (admin_name || hotel_name).split(" ").map(n => n[0]).join("").toUpperCase(),
      onboarding_complete: false
    });
    await staff.save();

    hotel.created_by = staff._id;
    await hotel.save();

    res.status(201).json({ success: true, data: { hotel, staff: { name: staff.name, email: staff.email } } });
  } catch (err) {
    next(err);
  }
};

exports.updateBusiness = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { hotel_name, city, number_of_rooms, is_active } = req.body;

    const hotel = await Hotel.findById(id);
    if (!hotel) return res.status(404).json({ success: false, message: "Business not found" });

    if (hotel_name !== undefined) hotel.hotel_name = hotel_name.trim();
    if (city !== undefined) hotel.city = city.trim();
    if (number_of_rooms !== undefined) hotel.number_of_rooms = parseInt(number_of_rooms);
    if (is_active !== undefined) hotel.is_active = is_active;

    await hotel.save();
    res.json({ success: true, data: hotel });
  } catch (err) {
    next(err);
  }
};

exports.deleteBusiness = async (req, res, next) => {
  try {
    const { id } = req.params;
    const hotel = await Hotel.findById(id);
    if (!hotel) return res.status(404).json({ success: false, message: "Business not found" });

    // Delete all associated data
    await Review.deleteMany({ hotel_id: id });
    await Ticket.deleteMany({ hotel_id: id });
    await Staff.deleteMany({ hotelId: id });
    await Hotel.findByIdAndDelete(id);

    res.json({ success: true, message: `Business "${hotel.hotel_name}" and all associated data deleted` });
  } catch (err) {
    next(err);
  }
};

// Toggle business active/inactive
exports.toggleBusinessActive = async (req, res, next) => {
  try {
    const { id } = req.params;
    const hotel = await Hotel.findById(id);
    if (!hotel) return res.status(404).json({ success: false, message: "Business not found" });

    const newStatus = !hotel.is_active;
    hotel.is_active = newStatus;

    // Toggle all properties to match the business status
    if (hotel.properties && hotel.properties.length > 0) {
      hotel.properties.forEach(prop => {
        prop.is_active = newStatus;
      });
      hotel.markModified('properties');
    }

    await hotel.save();

    // Toggle all reviews for this business
    await Review.updateMany({ hotel_id: hotel._id }, { $set: { is_active: newStatus } });

    res.json({
      success: true,
      data: { _id: hotel._id, is_active: hotel.is_active },
      message: hotel.is_active
        ? `Business "${hotel.hotel_name}" and its properties have been activated`
        : `Business "${hotel.hotel_name}" and its properties deactivated. Reviews hidden.`
    });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════
//  PROPERTIES (cross-business)
// ═══════════════════════════════════════════

exports.getAllProperties = async (req, res, next) => {
  try {
    const { business_id } = req.query;
    let query = {};

    // Build query based on user role
    if (req.user.role === "superadmin") {
      // Superadmin sees all properties across all businesses
      if (business_id) query._id = business_id;
    } else if (req.user.role === "owner" || req.user.role === "property_manager") {
      // Owner/Property Manager see only their business properties
      const staff = await Staff.findById(req.user.id);
      if (staff?.business_id) {
        query = { _id: staff.business_id };
      } else {
        return res.json({ success: true, data: [] });
      }
    } else {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const hotels = await Hotel.find(query).lean();
    const allProperties = [];

    for (const hotel of hotels) {
      for (const prop of (hotel.properties || [])) {
        const reviewCount = await Review.countDocuments({
          hotel_id: hotel._id,
          $or: [{ property_id: prop._id }, { hotel_name: prop.name }]
        });
        const connectedPlatforms = Object.entries(prop.platforms || {})
          .filter(([, u]) => u && u.startsWith("http"))
          .map(([p]) => p);

        allProperties.push({
          ...prop,
          business_id: hotel._id,
          business_name: hotel.hotel_name,
          business_is_active: hotel.is_active !== false,
          reviewCount,
          connectedPlatforms,
          last_sync_time: prop.last_sync_time || null,
          last_sync_status: prop.last_sync_status || "never"
        });
      }
    }

    res.json({ success: true, data: allProperties });
  } catch (err) {
    next(err);
  }
};

exports.addPropertyToAnyBusiness = async (req, res, next) => {
  try {
    const { business_id, name, city, rooms, timezone, platforms, image, description, is_active, max_reviews_per_sync } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: "property name is required" });
    }

    // Use provided business_id or default to user's hotel
    const hotelId = business_id || req.user?.hotel_id;

    if (!hotelId) {
      return res.status(400).json({ success: false, message: "Hotel not found" });
    }

    const hotel = await Hotel.findById(hotelId);
    if (!hotel) return res.status(404).json({ success: false, message: "Business not found" });

    hotel.properties.push({
      name: name.trim(),
      city: city?.trim() || "",
      rooms: parseInt(rooms) || 0,
      timezone: timezone || "IST",
      is_active: is_active !== false,
      platforms: platforms || {},
      image: image || "",
      description: description || "",
      max_reviews_per_sync: max_reviews_per_sync || 10
    });
    await hotel.save();

    const created = hotel.properties[hotel.properties.length - 1];
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    next(err);
  }
};

exports.updateAnyProperty = async (req, res, next) => {
  try {
    const { propertyId } = req.params;
    const { business_id, ...updates } = req.body;

    let hotel;
    if (business_id) {
      hotel = await Hotel.findById(business_id);
    } else {
      hotel = await Hotel.findOne({ "properties._id": propertyId });
    }
    if (!hotel) return res.status(404).json({ success: false, message: "Business not found" });

    const prop = hotel.properties.id(propertyId);
    if (!prop) return res.status(404).json({ success: false, message: "Property not found" });

    Object.keys(updates).forEach(key => {
      if (key !== "_id" && key !== "business_id") {
        prop[key] = updates[key];
      }
    });

    await hotel.save();
    res.json({ success: true, data: prop });
  } catch (err) {
    next(err);
  }
};

exports.deleteAnyProperty = async (req, res, next) => {
  try {
    const { propertyId } = req.params;

    const hotel = await Hotel.findOne({ "properties._id": propertyId });
    if (!hotel) return res.status(404).json({ success: false, message: "Property not found" });

    const prop = hotel.properties.id(propertyId);
    if (!prop) return res.status(404).json({ success: false, message: "Property not found" });

    const propName = prop.name;
    const propId = prop._id;

    prop.deleteOne();
    await hotel.save();

    await Review.deleteMany({ hotel_id: hotel._id, $or: [{ property_id: propId }, { hotel_name: propName }] });

    res.json({ success: true, message: `Property "${propName}" deleted` });
  } catch (err) {
    next(err);
  }
};

// Toggle property active/inactive
exports.togglePropertyActive = async (req, res, next) => {
  try {
    const { propertyId } = req.params;

    const hotel = await Hotel.findOne({ "properties._id": propertyId });
    if (!hotel) return res.status(404).json({ success: false, message: "Property not found" });

    const prop = hotel.properties.id(propertyId);
    if (!prop) return res.status(404).json({ success: false, message: "Property not found" });

    if (hotel.is_active === false && !prop.is_active) {
      return res.status(400).json({ success: false, message: "Please activate business first" });
    }

    const newStatus = !prop.is_active;
    prop.is_active = newStatus;
    await hotel.save();

    // Toggle reviews for this property
    await Review.updateMany(
      { hotel_id: hotel._id, $or: [{ property_id: prop._id }, { hotel_name: prop.name }] },
      { $set: { is_active: newStatus } }
    );

    res.json({
      success: true,
      data: { _id: prop._id, is_active: prop.is_active },
      message: prop.is_active
        ? `Property "${prop.name}" and its reviews have been activated`
        : `Property "${prop.name}" and its reviews deactivated`
    });
  } catch (err) {
    next(err);
  }
};
