let _id = 0;

/**
 * A bind group represents a collection of bindings and thus a collection
 * or resources. Bind groups are assigned to pipelines to provide them
 * with the required resources (like uniform buffers or textures).
 *
 * @private
 */
class BindGroup {

	/**
	 * Constructs a new bind group.
	 *
	 * @param {string} name - The bind group's name.
	 * @param {Array<Binding>} bindings - An array of bindings.
	 */
	constructor( name = '', bindings = [] ) {

		/**
		 * The bind group's name.
		 *
		 * @type {string}
		 */
		this.name = name;

		/**
		 * An array of bindings.
		 *
		 * @type {Array<Binding>}
		 */
		this.bindings = bindings;

		/**
		 * The group's ID.
		 *
		 * @type {number}
		 */
		this.id = _id ++;

		/**
		 * Incremented whenever the backend (re-)creates the bind group, e.g. after
		 * a texture of the group was replaced. Render bundles use it to detect
		 * recorded commands that refer to a previous bind group.
		 *
		 * @type {number}
		 * @default 0
		 */
		this.version = 0;

	}

}

export default BindGroup;
