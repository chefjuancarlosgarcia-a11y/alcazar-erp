import { supabase } from '../lib/supabase';

/**
 * User Roles Service
 * Manages all role-related operations with Supabase
 */

/**
 * Fetch all active user roles
 * @returns {Promise<Array>} List of active user roles
 */
export async function getUserRoles() {
  try {
    const { data, error } = await supabase
      .from('user_roles')
      .select('*')
      .eq('is_active', true)
      .order('category', { ascending: true })
      .order('role_name', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching user roles:', error);
    throw error;
  }
}

/**
 * Fetch all user roles including inactive ones (admin only)
 * @returns {Promise<Array>} List of all user roles
 */
export async function getAllUserRoles() {
  try {
    const { data, error } = await supabase
      .from('user_roles')
      .select('*')
      .order('is_system', { ascending: false })
      .order('category', { ascending: true })
      .order('role_name', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching all user roles:', error);
    throw error;
  }
}

/**
 * Fetch a single role by ID
 * @param {string} roleId - UUID of the role
 * @returns {Promise<Object>} Role object
 */
export async function getUserRole(roleId) {
  try {
    const { data, error } = await supabase
      .from('user_roles')
      .select('*')
      .eq('id', roleId)
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error fetching user role:', error);
    throw error;
  }
}

/**
 * Fetch role by role_key
 * @param {string} roleKey - The role key (e.g., 'admin', 'gerente_general')
 * @returns {Promise<Object>} Role object
 */
export async function getUserRoleByKey(roleKey) {
  try {
    const { data, error } = await supabase
      .from('user_roles')
      .select('*')
      .eq('role_key', roleKey)
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error fetching user role by key:', error);
    throw error;
  }
}

/**
 * Create a new user role
 * @param {Object} payload - Role data
 * @param {string} payload.role_name - Display name of the role
 * @param {string} payload.role_key - Unique identifier (optional, auto-generated from role_name)
 * @param {string} payload.category - Category of the role
 * @param {string} payload.description - Role description
 * @returns {Promise<Object>} Created role object
 */
export async function createUserRole(payload) {
  try {
    const {
      role_name,
      role_key,
      category,
      description,
      is_active = true,
    } = payload;

    if (!role_name || role_name.trim() === '') {
      throw new Error('El nombre del rol es obligatorio');
    }

    // Auto-generate role_key if not provided
    const normalizedKey = role_key || normalizeRoleName(role_name);

    // Check if role_key already exists
    const { data: existing } = await supabase
      .from('user_roles')
      .select('id')
      .eq('role_key', normalizedKey)
      .single();

    if (existing) {
      throw new Error(`El rol con clave "${normalizedKey}" ya existe`);
    }

    const { data, error } = await supabase
      .from('user_roles')
      .insert({
        role_name: role_name.trim(),
        role_key: normalizedKey,
        category: category || 'Personalizado',
        description: description || '',
        is_active,
        is_system: false,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error creating user role:', error);
    throw error;
  }
}

/**
 * Update an existing user role
 * @param {string} roleId - UUID of the role
 * @param {Object} payload - Role data to update
 * @returns {Promise<Object>} Updated role object
 */
export async function updateUserRole(roleId, payload) {
  try {
    const { role_name, category, description, is_active } = payload;

    const updateData = {};
    if (role_name !== undefined) updateData.role_name = role_name.trim();
    if (category !== undefined) updateData.category = category;
    if (description !== undefined) updateData.description = description;
    if (is_active !== undefined) updateData.is_active = is_active;

    const { data, error } = await supabase
      .from('user_roles')
      .update(updateData)
      .eq('id', roleId)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error updating user role:', error);
    throw error;
  }
}

/**
 * Deactivate a user role
 * @param {string} roleId - UUID of the role
 * @returns {Promise<Object>} Updated role object
 */
export async function deactivateUserRole(roleId) {
  try {
    const { data, error } = await supabase
      .from('user_roles')
      .update({ is_active: false })
      .eq('id', roleId)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error deactivating user role:', error);
    throw error;
  }
}

/**
 * Activate a user role
 * @param {string} roleId - UUID of the role
 * @returns {Promise<Object>} Updated role object
 */
export async function activateUserRole(roleId) {
  try {
    const { data, error } = await supabase
      .from('user_roles')
      .update({ is_active: true })
      .eq('id', roleId)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error activating user role:', error);
    throw error;
  }
}

/**
 * Normalize a role name to create a role_key
 * Converts to lowercase, removes accents, replaces spaces/special chars with underscores
 * @param {string} name - Role name to normalize
 * @returns {string} Normalized role key
 */
export function normalizeRoleName(name) {
  if (!name || typeof name !== 'string') return '';

  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .replace(/[^\w_]/g, '') // Remove special characters
    .replace(/_+/g, '_') // Collapse multiple underscores
    .replace(/^_+|_+$/g, ''); // Remove leading/trailing underscores
}

/**
 * Format role name for display
 * Converts snake_case to Title Case
 * @param {string} roleKey - Role key to format
 * @returns {string} Formatted role name
 */
export function formatRoleKey(roleKey) {
  if (!roleKey) return '';
  return roleKey
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Get roles by category
 * @param {string} category - Category filter
 * @returns {Promise<Array>} Roles in the category
 */
export async function getRolesByCategory(category) {
  try {
    const { data, error } = await supabase
      .from('user_roles')
      .select('*')
      .eq('category', category)
      .eq('is_active', true)
      .order('role_name', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching roles by category:', error);
    throw error;
  }
}

/**
 * Get all unique categories
 * @returns {Promise<Array>} List of categories
 */
export async function getRoleCategories() {
  try {
    const { data, error } = await supabase
      .from('user_roles')
      .select('category')
      .eq('is_active', true)
      .order('category', { ascending: true });

    if (error) throw error;

    // Get unique categories
    const categories = [...new Set(data.map((r) => r.category))];
    return categories.filter(Boolean);
  } catch (error) {
    console.error('Error fetching role categories:', error);
    throw error;
  }
}

/**
 * Check if a role exists
 * @param {string} roleKey - Role key to check
 * @returns {Promise<boolean>} True if role exists and is active
 */
export async function roleExists(roleKey) {
  try {
    const { data, error } = await supabase
      .from('user_roles')
      .select('id')
      .eq('role_key', roleKey)
      .eq('is_active', true)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return !!data;
  } catch (error) {
    console.error('Error checking role existence:', error);
    return false;
  }
}

export default {
  getUserRoles,
  getAllUserRoles,
  getUserRole,
  getUserRoleByKey,
  createUserRole,
  updateUserRole,
  deactivateUserRole,
  activateUserRole,
  normalizeRoleName,
  formatRoleKey,
  getRolesByCategory,
  getRoleCategories,
  roleExists,
};
