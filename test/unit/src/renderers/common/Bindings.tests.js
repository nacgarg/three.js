import Bindings from '../../../../../src/renderers/common/Bindings.js';
import BindGroup from '../../../../../src/renderers/common/BindGroup.js';

function createBindings() {

	const destroyed = [];

	const backend = {
		createUniformBuffer() {},
		destroyUniformBuffer( binding ) {

			destroyed.push( binding );

		},
		createBindings() {},
		deleteBindGroupData() {}
	};

	const info = {
		createUniformBuffer() {},
		destroyUniformBuffer() {}
	};

	const bindings = new Bindings( backend, {}, {}, {}, {}, info );

	return { bindings, destroyed };

}

function createRenderObject( bindGroups ) {

	return {
		getBindings() {

			return bindGroups;

		}
	};

}

export default QUnit.module( 'Renderers', () => {

	QUnit.module( 'Common', () => {

		QUnit.module( 'Bindings', () => {

			QUnit.test( 'deleteForRender releases only acquired bind groups', ( assert ) => {

				const { bindings, destroyed } = createBindings();

				const uniformBuffer = { isUniformBuffer: true, release() {} };
				const sharedGroup = new BindGroup( 'render', [ uniformBuffer ] );

				const renderObjectA = createRenderObject( [ sharedGroup ] );
				const renderObjectB = createRenderObject( [ sharedGroup ] );

				bindings.getForRender( renderObjectA );

				// B shares the group but is disposed before it was ever rendered

				bindings.deleteForRender( renderObjectB );

				assert.strictEqual( destroyed.length, 0, 'Shared uniform buffer is kept while still in use.' );

				bindings.deleteForRender( renderObjectA );

				assert.strictEqual( destroyed.length, 1, 'Shared uniform buffer is destroyed with its last user.' );

			} );

			QUnit.test( 'deleteForRender does not request bindings of render objects that never acquired them', ( assert ) => {

				const { bindings } = createBindings();

				let requested = false;

				const renderObject = {
					getBindings() {

						requested = true;
						return [];

					}
				};

				bindings.deleteForRender( renderObject );

				assert.strictEqual( requested, false, 'No bindings (and node build) requested on dispose.' );

			} );

		} );

	} );

} );
