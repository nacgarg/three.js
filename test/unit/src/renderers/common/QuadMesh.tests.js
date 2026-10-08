import QuadMesh from '../../../../../src/renderers/common/QuadMesh.js';
import NodeMaterial from '../../../../../src/materials/nodes/NodeMaterial.js';

const renderer = { render() {} };

export default QUnit.module( 'Renderers', () => {

	QUnit.module( 'Common', () => {

		QUnit.module( 'QuadMesh', () => {

			QUnit.test( 'releases an assigned material when it is disposed', ( assert ) => {

				const quad = new QuadMesh();
				const initialMaterial = quad.material;

				const materialA = new NodeMaterial();
				const materialB = new NodeMaterial();

				quad.material = materialA;
				quad.render( renderer );

				quad.material = materialB;
				quad.render( renderer );

				materialA.dispose();

				assert.strictEqual( quad.material, materialB, 'Disposing a previously rendered material keeps the current one.' );

				materialB.dispose();

				assert.strictEqual( quad.material, initialMaterial, 'Disposing the current material resets the quad mesh material.' );
				assert.strictEqual( materialB.hasEventListener( 'dispose', quad._onMaterialDispose ), false, 'The dispose listener is removed.' );

			} );

			QUnit.test( 'keeps the material it was created with', ( assert ) => {

				const material = new NodeMaterial();
				const quad = new QuadMesh( material );

				quad.render( renderer );
				material.dispose();

				assert.strictEqual( quad.material, material, 'The initial material is kept after dispose.' );

			} );

		} );

	} );

} );
